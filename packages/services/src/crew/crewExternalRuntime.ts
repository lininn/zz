import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  resolveWorkspaceKey,
  crewRuntimeReplySchema,
  CREW_EXTERNAL_TIMEOUT_MAX_MS,
  type CrewWorkspaceBinding,
  type CrewRuntimeTask,
  type CrewRuntimeCommand,
  type CrewRuntimeReply,
  type CrewRuntimeProbe,
} from "@zcode/shared";
import type { IZCodeAgentService } from "#src/zcode-agent/zcodeAgent.js";
import type { CrewRuntimePort } from "./contract.js";
import type { CrewLeaseStore, CrewWorkspaceLease } from "./crewLease.js";
import { isCrewOwnerAlive, isCrewRuntimeTreeAlive } from "./crewLease.js";

const TASK_PREFIX = "crew_ext_";
const POLL_INTERVAL_MS = 100;
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const REJECTED = new Set(["runtime_unavailable", "workspace_unsupported"]);
type CrewInput = Parameters<CrewRuntimePort["execute"]>[0];
type Active = {
  cancelled: boolean;
  start?: Promise<CrewRuntimeTask>;
  lease?: CrewWorkspaceLease;
  releasing?: Promise<void>;
};
export function isCrewExternalTask(taskId: string): boolean {
  return taskId.startsWith(TASK_PREFIX);
}

/** 外部执行只有 CLI dispatch 一个事实源；本地轮询只读取投影，不推进 vendor 状态。 */
export function createCrewExternalRuntime(options: {
  agent: IZCodeAgentService;
  leases: CrewLeaseStore;
  start(
    binding: CrewWorkspaceBinding,
    lease: CrewWorkspaceLease,
    command: Extract<CrewRuntimeCommand, { action: "start" }>,
  ): Promise<CrewRuntimeReply>;
  prompt(input: CrewInput): string;
  preflight(binding: CrewWorkspaceBinding): Promise<void>;
}) {
  const { agent, leases } = options;
  const active = new Map<string, Active>();
  // 群详情每 2.5s 轮询会对同一外部成员反复探测：每次都要 spawn CLI（--version/auth），
  // 耗时数秒。按 binding+成员+访问模式缓存，并采用 stale-while-revalidate：
  // 命中未过期直接返回；命中已过期立即返回旧值、后台刷新；只有完全无缓存才等待首次探测。
  // 这样读路径（crew.get）永远不会被 CLI 探测阻塞。
  const PROBE_TTL_MS = 30_000;
  // 后台刷新必须自身有界：Agent 进程被杀/正在重连时探测可能永不 settle，
  // 否则缓存永远填不上、详情投影永远拿不到可用性信息（且 probeRefreshes 永久占用）。
  const PROBE_READ_TIMEOUT_MS = 8_000;
  const probes = new Map<string, { at: number; value: CrewRuntimeProbe | null }>();
  const probeRefreshes = new Map<string, Promise<void>>();
  async function command(binding: CrewWorkspaceBinding, input: CrewRuntimeCommand) {
    if (!agent.crewRuntime)
      throw Object.assign(new Error("crew.runtimeUnavailable"), { code: -32601 });
    return crewRuntimeReplySchema.parse(await agent.crewRuntime({ ...binding, command: input }));
  }
  async function task(binding: CrewWorkspaceBinding, input: CrewRuntimeCommand) {
    const reply =
      input.action === "start"
        ? crewRuntimeReplySchema.parse(
            await options.start(binding, active.get(input.taskId)!.lease!, input),
          )
        : await command(binding, input);
    if (reply.kind !== "task" || !("taskId" in input) || reply.task.taskId !== input.taskId)
      throw new Error("crew.recoveryRequired");
    return reply.task;
  }
  async function release(state: Active) {
    if (state.releasing) return state.releasing;
    const lease = state.lease;
    if (!lease) return;
    state.releasing = (async () => {
      if (!(await leases.release(lease))) throw new Error("crew.recoveryRequired");
      state.lease = undefined;
    })();
    return state.releasing;
  }
  return {
    async probeMember(binding, member, callOptions) {
      if (member.runtime === "zcode") return null;
      // 收窄结果必须存成 const：在下面的闭包里读 member.runtime 会丢失收窄，
      // 重新变回含 "zcode" 的联合类型（member 是参数，TS 不跨函数边界保留收窄）。
      const runtimeId = member.runtime;
      const cacheKey = `${resolveWorkspaceKey(binding)}|${runtimeId}|${member.accessMode}`;
      const fresh = async (): Promise<CrewRuntimeProbe> => {
        try {
          await options.preflight(binding);
          const reply = await command(binding, {
            action: "probe",
            runtimeId,
            accessMode: member.accessMode,
          });
          if (reply.kind !== "probe" || reply.probe.runtimeId !== runtimeId)
            throw new Error("crew.runtimeUnavailable");
          return reply.probe;
        } catch (error) {
          // 旧 Agent bundle / 缺失 bridge 不等于 vendor 未安装；只识别协议错误码，
          // 不把可能包含凭据或用户路径的任意异常正文传到 UI。
          const missingBridge = error instanceof Error && "code" in error && error.code === -32601;
          return {
            runtimeId,
            available: false,
            reason: missingBridge
              ? "crew/runtime unavailable: restart the server with a current Agent runtime"
              : "crew.runtimeUnavailable",
          };
        }
      };
      // 详情投影（cached）绝不允许等待 CLI：命中未过期直接返回；命中已过期返回旧值并
      // 后台刷新；连缓存都没有时也立即返回 null（本轮不展示可用性），探测在后台完成、
      // 下一轮轮询自然拿到结果。只有准入/接力/执行路径才同步等待探测结果。
      if (callOptions?.cached) {
        const cached = probes.get(cacheKey);
        if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.value;
        if (!probeRefreshes.has(cacheKey)) {
          // 后台刷新自身有界：Agent 掉线时探测可能永不 settle，必须超时收口，
          // 否则缓存填不上、probeRefreshes 永久占用。
          const pending = Promise.race([
            fresh(),
            new Promise<CrewRuntimeProbe>((resolve) => {
              const timer = setTimeout(
                () => resolve({ runtimeId, available: false, reason: "crew.runtimeUnavailable" }),
                PROBE_READ_TIMEOUT_MS,
              );
              timer.unref?.();
            }),
          ])
            .then((value) => {
              probes.set(cacheKey, { at: Date.now(), value });
            })
            .finally(() => probeRefreshes.delete(cacheKey));
          probeRefreshes.set(cacheKey, pending);
        }
        return cached?.value ?? null;
      }
      // 准入/接力/执行前必须实时探测：可用性可能在缓存窗口内变化，不能复用旧结果。
      const value = await fresh();
      probes.set(cacheKey, { at: Date.now(), value });
      return value;
    },
    inspect: (binding, taskId) => task(binding, { action: "read", taskId }),
    async respondPermission(binding, taskId, requestId, approved) {
      const reply = await task(binding, { action: "permission", taskId, requestId, approved });
      if (reply.permission?.requestId === requestId || reply.runtimeState === "recovery_required")
        throw new Error("crew.recoveryRequired");
    },
    async execute(input) {
      if (input.member.runtime === "zcode") throw new Error("crew.runtimeUnavailable");
      const binding = input.execution.workspaceBinding;
      const probe = await this.probeMember!(binding, input.member);
      if (!probe?.available) throw new Error("crew.runtimeUnavailable");
      const objective = options.prompt(input);
      const previous = input.resumeTaskId
        ? await task(binding, { action: "read", taskId: input.resumeTaskId })
        : undefined;
      // 成功结果不保证 vendor 返回原生会话 ID；不能把无 ID 的历史当成可续跑会话。
      const resumeTaskId =
        previous?.runtimeState === "succeeded" &&
        previous.settled &&
        previous.nativeSessionId &&
        previous.runtimeId === input.member.runtime
          ? input.resumeTaskId
          : undefined;
      const taskId = `${TASK_PREFIX}${input.execution.executionId}`;
      const state: Active = { cancelled: false };
      active.set(taskId, state);
      try {
        await input.onTaskCreated(taskId);
        if (state.cancelled) return { taskId, status: "cancelled", text: "crew.cancelled" };
        await agent.initialize(binding);
        const identity = await agent.getWorkspaceRuntimeIdentity(binding);
        state.lease = await leases.acquire({
          workspaceKey: resolveWorkspaceKey(binding),
          sessionId: taskId,
          runtimePid: identity.processId,
        });
        if (state.cancelled) {
          await release(state);
          return { taskId, status: "cancelled", text: "crew.cancelled" };
        }
        // start 的 ACK 可能丢失；一旦发出请求，只有同 taskId 的 settled 证明能释放租约。
        state.start = task(binding, {
          action: "start",
          taskId,
          runtimeId: input.member.runtime,
          // 默认对话 ID 固定为 groupId，保留 v5 原生键以通过 CLI 续接的 sessionId 校验。
          // 其他对话把 ID 纳入键，不能仅隔离群板却复用另一个任务的原生历史。
          sessionId: `crew_${createHash("sha256")
            .update(
              JSON.stringify([
                input.group.groupId,
                ...(input.execution.conversationId === input.group.groupId
                  ? []
                  : [input.execution.conversationId]),
                input.execution.epoch,
                input.member,
              ]),
            )
            .digest("hex")}`,
          traceId: input.execution.executionId,
          objective,
          accessMode: input.member.accessMode,
          // 子任务不自设超时：直接采用群级接力预算（root 冻结快照）。
          // 链级墙钟仍由 CrewExecutionDeadline 兜底，这里只作为进程 supervisor 上限。
          timeoutMs: Math.min(
            CREW_EXTERNAL_TIMEOUT_MAX_MS,
            (input.execution.relayBudgetMinutes ?? 30) * 60_000,
          ),
          ...(resumeTaskId ? { resumeTaskId } : {}),
        });
        let snapshot = await state.start;
        // vendor 可能在请求审批后退出；未决审批仍须留在群板，不能被终态文本吞掉。
        while (
          !snapshot.settled ||
          snapshot.runtimeState === "awaiting_permission" ||
          snapshot.permission
        ) {
          if (snapshot.runtimeState === "recovery_required")
            throw new Error("crew.recoveryRequired");
          await delay(POLL_INTERVAL_MS);
          snapshot = await task(binding, { action: "read", taskId });
        }
        if (
          snapshot.runtimeId !== input.member.runtime ||
          snapshot.runtimeState === "recovery_required"
        )
          throw new Error("crew.recoveryRequired");
        if (!TERMINAL.has(snapshot.runtimeState) && !REJECTED.has(snapshot.runtimeState)) {
          // 已确认进程停止但执行不合规，不得展示成功；保留结构化失败而非猜测 vendor 状态。
          await release(state);
          return { taskId, status: "failed", text: "crew.externalFailed" };
        }
        await release(state);
        return {
          taskId,
          status: REJECTED.has(snapshot.runtimeState)
            ? "failed"
            : (snapshot.runtimeState as "succeeded" | "failed" | "cancelled"),
          text: REJECTED.has(snapshot.runtimeState)
            ? "crew.runtimeUnavailable"
            : (snapshot.summary ??
              (snapshot.runtimeState === "cancelled" ? "crew.cancelled" : "crew.externalFailed")),
        };
      } finally {
        active.delete(taskId);
      }
    },
    async cancel(binding, taskId) {
      const state = active.get(taskId);
      if (state) {
        state.cancelled = true;
        if (!state.start) return; // execute 会在每个 await 后、start 前检查取消，尚未投递。
        await state.start.catch(() => {});
      }
      const lease = await leases.get(resolveWorkspaceKey(binding));
      if (lease && lease.sessionId !== taskId) throw new Error("crew.workspaceBusy");
      if (lease && lease.ownerId !== leases.ownerId) {
        if (
          !isCrewOwnerAlive(lease.ownerId) &&
          lease.runtimePid !== null &&
          !isCrewRuntimeTreeAlive(lease.runtimePid)
        ) {
          await leases.release(lease);
          return;
        }
        throw new Error("crew.recoveryRequired");
      }
      const snapshot = await task(binding, { action: "cancel", taskId });
      if (!snapshot.settled || !TERMINAL.has(snapshot.runtimeState))
        throw new Error("crew.recoveryRequired");
      // execute 与 cancel 共享同一 lease 对象；先清引用再释放，避免重复 CAS 被误认为失联。
      if (state) await release(state);
      else if (lease && !(await leases.release(lease))) throw new Error("crew.recoveryRequired");
    },
  } satisfies Pick<
    CrewRuntimePort,
    "probeMember" | "inspect" | "respondPermission" | "execute" | "cancel"
  >;
}
