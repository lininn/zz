import { isCrewExternalTask } from "./crewExternalRuntime.js";
import {
  resolveWorkspaceKey,
  type CrewRuntimeCommand,
  type CrewWorkspaceBinding,
} from "@zcode/shared";
import type { CommandAck, CommandEnvelope, SessionPhase } from "@zcode/shared/zcode-protocol-v4";
import type { IZCodeAgentService, ZCodeAgentSessionTarget } from "#src/zcode-agent/zcodeAgent.js";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import {
  CrewLeaseStore,
  isCrewRuntimeTreeAlive,
  killCrewRuntimeTree,
  type CrewWorkspaceLease,
} from "./crewLease.js";
import { CrewAdmissionMonitor, isCrewWorkspaceQuiescent } from "./crewAdmissionMonitor.js";

const log = createServiceLogger("agent-crew-admission");
const writerCommands = new Set([
  "sendText",
  "sendGoalCommand",
  "retryTurn",
  "editUserQuery",
  "sendQueuedNow",
  "resumeGoal",
  "resumeWorkflowRun",
  "startSavedWorkflow",
  "applyFileRewind",
  "compact",
  "setAutoDrain",
]);
export function needsCrewWriteAdmission(envelope: CommandEnvelope): boolean {
  if (writerCommands.has(envelope.type)) return true;
  if (envelope.type === "createSession" || envelope.type === "createSelectionSideSession") {
    return Boolean((envelope.payload as { firstInput?: unknown }).firstInput);
  }
  return false;
}
interface Entry {
  lease: CrewWorkspaceLease;
  monitor?: CrewAdmissionMonitor;
  verifiedAfterAck: boolean;
  pendingInputs: Set<string>;
  interrupted?: boolean;
  idleWaiters: Array<{ resolve(phase: SessionPhase): void; reject(error: Error): void }>;
}

/** 装配在 base AgentService 外：桌面 V4、手机 replayable 和后台 task facade 共用一次准入。 */
export class CrewWriteAdmission {
  private readonly entries = new Map<string, Entry>();
  private readonly terminalPhases = new Map<string, SessionPhase>();
  private readonly chains = new Map<string, Promise<unknown>>();
  private closed = false;
  constructor(
    private readonly agent: IZCodeAgentService,
    readonly leases: CrewLeaseStore,
    private readonly runtimeAlive = isCrewRuntimeTreeAlive,
  ) {}

  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.chains.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.chains.set(key, next);
    void next
      .finally(() => {
        if (this.chains.get(key) === next) this.chains.delete(key);
      })
      .catch(() => {});
    return next;
  }

  async run<T>(
    target: ZCodeAgentSessionTarget,
    operation: () => Promise<T>,
    options: {
      createsSession?: boolean;
      inputId?: string;
      targetFrom?: (result: T) => string | undefined;
      rejected?: (result: T) => boolean;
      uncertain?: (result: T) => boolean;
    } = {},
  ): Promise<T> {
    // 外部 task ID 属于专用派工命名空间；普通输入不能以同名 session 借用其租约。
    if (isCrewExternalTask(target.sessionId)) throw new Error("crew.workspaceBusy");
    const key = resolveWorkspaceKey(target);
    return this.serial(key, async () => {
      if (this.closed) throw new Error("crew.serviceClosed");
      await this.reapDeadEntry(key);
      let entry = this.entries.get(key);
      const newlyAcquired = !entry;
      if (entry?.interrupted) throw new Error("crew.recoveryRequired");
      if (entry && entry.lease.sessionId !== target.sessionId)
        throw new Error("crew.workspaceBusy");
      if (!entry) {
        // 仅准备 runtime、不投递写入；保存实际 PID 后才允许模型开始。
        await this.agent.initialize(target);
        const identity = await this.agent.getWorkspaceRuntimeIdentity(target);
        if (this.closed) throw new Error("crew.serviceClosed");
        // 无本地 monitor 的既有本 Host 租约不等于本次新建租约，不能在订阅失败时释放。
        const existingLease = await this.leases.get(key);
        if (existingLease?.ownerId === this.leases.ownerId) throw new Error("crew.workspaceBusy");
        const lease = await this.leases.acquire({
          workspaceKey: key,
          sessionId: target.sessionId,
          runtimePid: identity.processId,
        });
        if (this.closed) {
          await this.leases.release(lease);
          throw new Error("crew.serviceClosed");
        }
        this.terminalPhases.delete(`${key}\0${target.sessionId}`);
        entry = { lease, verifiedAfterAck: false, pendingInputs: new Set(), idleWaiters: [] };
        this.entries.set(key, entry);
        if (!options.createsSession) {
          try {
            await this.observe(entry, target);
          } catch (error) {
            // 尚未发送任何命令，订阅失败可安全退还刚创建的租约。
            await this.leases.release(lease);
            this.entries.delete(key);
            throw error;
          }
        }
      }
      if (this.closed) throw new Error("crew.serviceClosed");
      const previousProof = entry.verifiedAfterAck;
      const wasPending = options.inputId ? entry.pendingInputs.has(options.inputId) : false;
      if (options.inputId) entry.pendingInputs.add(options.inputId);
      entry.verifiedAfterAck = false;
      try {
        const result = await operation();
        if (options.rejected?.(result)) {
          // B 被拒不能清掉 A 尚未完成的证明屏障；首次明确拒绝才可复用发送前的空闲快照。
          entry.verifiedAfterAck = previousProof || newlyAcquired;
          if (options.inputId && !wasPending) entry.pendingInputs.delete(options.inputId);
          if (!entry.monitor) {
            await this.leases.release(entry.lease);
            this.entries.delete(key);
          }
        } else if (!options.uncertain?.(result)) {
          const sessionId = options.createsSession
            ? options.targetFrom?.(result)
            : target.sessionId;
          if (!sessionId) throw new Error("crew.recoveryRequired");
          if (options.createsSession) await this.leases.bindSession(entry.lease, sessionId);
          // ACK 与 UI flush 没有同步关系。必须在 ACK 后新建独立订阅，以新 subscriptionId
          // 的 initial snapshot 建立读取屏障；它仍不代表输入已执行，下面另以 inputId
          // 权威行作准入证明，不能将任意较新 seq/旧 idle 当成命令已收口。
          await this.observe(entry, { ...target, sessionId });
          if (this.closed) throw new Error("crew.recoveryRequired");
          entry.verifiedAfterAck = true;
        }
        this.scheduleRelease(key, entry);
        return result;
      } catch (error) {
        // 传输报错不证明命令未被接受；仅新权威终态或已退出的进程能解除隔离。
        this.scheduleRelease(key, entry);
        throw error;
      }
    });
  }

  private async observe(entry: Entry, target: ZCodeAgentSessionTarget): Promise<void> {
    entry.monitor?.dispose();
    entry.monitor = new CrewAdmissionMonitor(this.agent, target, () => {
      // Core ACK 可能早于 TurnStarted；必须观察到本次 inputId 的权威行。
      // 仅见 queue item 不算开始：promote 移除队列到建立 turn 之间仍可能有空窗。
      for (const row of entry.monitor?.snapshot?.rows.window ?? []) {
        if ("sourceCommandId" in row && row.sourceCommandId)
          entry.pendingInputs.delete(row.sourceCommandId);
      }
      this.scheduleRelease(entry.lease.workspaceKey, entry);
    });
    await entry.monitor.start();
  }

  private scheduleRelease(key: string, entry: Entry): void {
    void this.serial(key, async () => {
      if (this.closed || this.entries.get(key) !== entry) return;
      const snapshot = entry.monitor?.snapshot;
      if (
        !snapshot ||
        !entry.verifiedAfterAck ||
        entry.pendingInputs.size > 0 ||
        !isCrewWorkspaceQuiescent(snapshot)
      )
        return;
      if (!(await this.leases.release(entry.lease))) {
        entry.interrupted = true;
        for (const waiter of entry.idleWaiters) waiter.reject(new Error("crew.recoveryRequired"));
        entry.idleWaiters = [];
        return;
      }
      const terminalKey = `${key}\0${entry.lease.sessionId}`;
      this.terminalPhases.set(terminalKey, snapshot.control.phase);
      if (this.terminalPhases.size > 128)
        this.terminalPhases.delete(this.terminalPhases.keys().next().value!);
      this.entries.delete(key);
      entry.monitor?.dispose();
      for (const waiter of entry.idleWaiters) waiter.resolve(snapshot.control.phase);
    }).catch(() => log.warn(undefined, "群组写租约收口失败，保持隔离"));
  }

  async cancelSafely(target: ZCodeAgentSessionTarget, stop: () => Promise<void>): Promise<void> {
    const key = resolveWorkspaceKey(target);
    await this.serial(key, async () => {
      if (this.closed) throw new Error("crew.recoveryRequired");
      await this.reapDeadEntry(key);
      const entry = this.entries.get(key);
      if (entry?.interrupted) throw new Error("crew.recoveryRequired");
      if (entry) entry.verifiedAfterAck = false;
      await stop();
      if (entry && this.entries.get(key) === entry) {
        await this.observe(entry, target);
        entry.verifiedAfterAck = true;
        this.scheduleRelease(key, entry);
      }
    });
    await this.whenQuiescent(target);
  }

  async whenQuiescent(target: ZCodeAgentSessionTarget): Promise<SessionPhase | undefined> {
    if (this.closed) throw new Error("crew.recoveryRequired");
    const key = resolveWorkspaceKey(target);
    const entry = this.entries.get(key);
    if (entry?.interrupted) throw new Error("crew.recoveryRequired");
    const terminalKey = `${key}\0${target.sessionId}`;
    if (!entry || entry.lease.sessionId !== target.sessionId) {
      const phase = this.terminalPhases.get(terminalKey);
      this.terminalPhases.delete(terminalKey);
      // Bugfix 诊断：crew 派工在 sendPrompt 后读取会话阶段拿到 undefined 会被
      // 转成 recoveryRequired。这里必须留现场：entry 消失（收口竞态）还是
      // lease.sessionId 与派工目标错位。
      log.warn(undefined, "crew 准入 whenQuiescent 走 terminal 兜底", {
        event: "crew.admission.when_quiescent_terminal",
        module: "agent-crew-admission",
        workspaceKey: key,
        targetSessionId: target.sessionId,
        entryExists: Boolean(entry),
        leaseSessionId: entry?.lease.sessionId ?? null,
        terminalPhaseHit: phase ?? null,
      });
      return phase;
    }
    const phase = await new Promise<SessionPhase>((resolve, reject) =>
      entry.idleWaiters.push({ resolve, reject }),
    );
    this.terminalPhases.delete(terminalKey);
    return phase;
  }

  async startExternal(
    binding: CrewWorkspaceBinding,
    lease: CrewWorkspaceLease,
    command: Extract<CrewRuntimeCommand, { action: "start" }>,
  ) {
    const current = await this.leases.get(resolveWorkspaceKey(binding));
    if (
      this.closed ||
      !current ||
      current.token !== lease.token ||
      current.ownerId !== this.leases.ownerId ||
      current.sessionId !== command.taskId
    )
      throw new Error("crew.workspaceBusy");
    return this.agent.crewRuntime({ ...binding, command });
  }

  wrap<T extends IZCodeAgentService>(base: T): T {
    return {
      ...base,
      crewRuntime: async (params) => {
        // 公开 RPC 不能借用普通会话的同名租约；外部 start 只由内部持令牌的入口派发。
        if (params.command.action === "start") throw new Error("crew.workspaceBusy");
        return base.crewRuntime(params);
      },
      sendPrompt: (params) =>
        this.run(params, () => base.sendPrompt(params), { inputId: params.inputId }),
      compactSession: (params) =>
        this.run(params, () => base.compactSession(params), { inputId: params.inputId }),
      goalSession: (params) =>
        this.run(params, () => base.goalSession(params), { inputId: params.inputId }),
      sendConversationCommandV4: (params) => {
        if (!needsCrewWriteAdmission(params.envelope))
          return base.sendConversationCommandV4(params);
        const createsSession = ["createSession", "createSelectionSideSession"].includes(
          params.envelope.type,
        );
        const sessionId = createsSession
          ? `agent_crew_command:${params.envelope.commandId}`
          : params.envelope.sessionId;
        if (!sessionId) return Promise.reject(new Error("crew.recoveryRequired"));
        return this.run({ ...params, sessionId }, () => base.sendConversationCommandV4(params), {
          createsSession,
          ...([
            "sendText",
            "sendGoalCommand",
            "retryTurn",
            "editUserQuery",
            "compact",
            "resumeGoal",
          ].includes(params.envelope.type) || createsSession
            ? { inputId: params.envelope.commandId }
            : {}),
          targetFrom: (ack: CommandAck) =>
            ack.result && "sessionId" in ack.result ? ack.result.sessionId : undefined,
          rejected: (ack: CommandAck) => ["rejected", "stale", "noop"].includes(ack.status),
          uncertain: (ack: CommandAck) => ack.status === "failed",
        });
      },
    };
  }

  private async reapDeadEntry(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry || entry.lease.runtimePid === null || this.runtimeAlive(entry.lease.runtimePid))
      return;
    entry.monitor?.dispose();
    await this.leases.release(entry.lease);
    this.entries.delete(key);
    for (const waiter of entry.idleWaiters) waiter.reject(new Error("crew.recoveryRequired"));
  }

  /**
   * 人工确认恢复后的强制收口：interrupted entry 因孤儿进程组尚存而无法自动 reap 时，
   * 用户「检查恢复」即显式承认该工作目录上不会再有旧执行写入——强杀残留进程组并
   * 释放租约，放行后续派工。没有这一步，interrupted entry 会永久阻塞该 workspace。
   */
  async confirmInterrupted(params: {
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<void> {
    const key = resolveWorkspaceKey(params);
    await this.serial(key, async () => {
      const entry = this.entries.get(key);
      if (!entry) return;
      if (entry.lease.runtimePid !== null && isCrewRuntimeTreeAlive(entry.lease.runtimePid)) {
        killCrewRuntimeTree(entry.lease.runtimePid);
      }
      entry.monitor?.dispose();
      try {
        await this.leases.release(entry.lease);
      } catch (error) {
        log.warn(undefined, "确认恢复释放租约失败，仍放行新派工", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.entries.delete(key);
      for (const waiter of entry.idleWaiters) waiter.reject(new Error("crew.recoveryRequired"));
      entry.idleWaiters = [];
    });
  }

  onRuntimeExit(pid: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.lease.runtimePid !== pid) continue;
      entry.interrupted = true;
      // 主进程退出立即结束等待，但孤儿进程组尚存时继续保留工作目录隔离。
      if (entry.monitor) {
        entry.monitor.snapshot = undefined;
        entry.monitor.dispose();
      }
      for (const waiter of entry.idleWaiters) waiter.reject(new Error("crew.recoveryRequired"));
      entry.idleWaiters = [];
      void this.serial(key, () => this.reapDeadEntry(key)).catch(() => {});
    }
  }

  async whenIdle(): Promise<void> {
    while (this.chains.size) await Promise.allSettled(this.chains.values());
  }

  dispose(): void {
    this.closed = true;
    for (const entry of this.entries.values()) {
      entry.monitor?.dispose();
      for (const waiter of entry.idleWaiters) waiter.reject(new Error("crew.recoveryRequired"));
    }
    this.entries.clear();
    this.terminalPhases.clear();
  }
}
