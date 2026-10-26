import { invalidateCrewRelayAdmissions } from "./crewRelayControl.js";
import { CrewExecutionDeadline } from "./crewExecutionDeadline.js";
import { respondCrewPermission } from "./crewPermission.js";
import type { CrewRelayParams } from "@zcode/shared";
import { CrewRelay } from "./crewRelay.js";
import { readCrewExecutionDetail, readCrewGroupDetail } from "./crewExecutionDetail.js";
import type { CrewExecutionDetailParams } from "@zcode/shared";
import { type CrewPermissionParams } from "@zcode/shared";
import {
  crewConversationCreateParamsSchema,
  crewConversationDeleteParamsSchema,
  crewConversationListParamsSchema,
  type CrewConversation,
  type CrewConversationCreateParams,
  type CrewConversationDeleteParams,
  type CrewConversationListParams,
  crewBindParamsSchema,
  crewCancelParamsSchema,
  crewCreateParamsSchema,
  crewDeleteParamsSchema,
  crewDuplicateParamsSchema,
  crewGetParamsSchema,
  crewListParamsSchema,
  crewMemberSchema,
  crewRecoverParamsSchema,
  crewSendParamsSchema,
  crewUpdateParamsSchema,
  type CrewBindParams,
  type CrewCancelParams,
  type CrewCreateParams,
  type CrewDeleteParams,
  type CrewDuplicateParams,
  type CrewExecution,
  type CrewGetParams,
  type CrewGroup,
  type CrewGroupDetail,
  type CrewListParams,
  type CrewMember,
  type CrewMemberInput,
  type CrewRecoverParams,
  type CrewSendParams,
  type CrewSendResult,
  type CrewUpdateParams,
} from "@zcode/shared";
import { randomUUID } from "node:crypto";
import { isAbsolute, win32 } from "node:path";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import type { CrewServiceOptions, ICrewService } from "./contract.js";
import { CrewStore } from "./crewStore.js";
import { CrewExecutionStore } from "./crewExecutionStore.js";

const log = createServiceLogger("agent-crew");
function membersWithIds(inputs: CrewMemberInput[]): CrewMember[] {
  const members = inputs.map((member) =>
    crewMemberSchema.parse({ ...member, memberId: member.memberId ?? randomUUID() }),
  );
  if (new Set(members.map((member) => member.memberId)).size !== members.length)
    throw new Error("crew.duplicateMemberId");
  return members;
}

/** 唯一业务所有者；runtime 只执行注入端口，不持有第二份 accepted queue。 */
export class CrewService implements ICrewService {
  private readonly store: CrewStore;
  private readonly executionStore: CrewExecutionStore;
  private readonly relay: CrewRelay;
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly requested = new Set<string>();
  private closed = false;

  constructor(private readonly options: CrewServiceOptions) {
    crewGetParamsSchema.shape.groupId.parse(options.ownerId);
    this.store = new CrewStore(options.databasePath);
    this.executionStore = new CrewExecutionStore(this.store, options.ownerId);
    this.relay = new CrewRelay(this.store, options.runtime, () => this.closed);
  }
  private async ready(): Promise<void> {
    if (this.closed) throw new Error("crew.serviceClosed");
    await this.store.initialize();
    if (this.closed) throw new Error("crew.serviceClosed");
  }
  async readExecution(params: CrewExecutionDetailParams) {
    await this.ready();
    return readCrewExecutionDetail(this.store, this.options.runtime, params);
  }
  async list(params: CrewListParams): Promise<CrewGroup[]> {
    crewListParamsSchema.parse(params);
    await this.ready();
    return this.store.transaction(() => this.store.list());
  }
  async listConversations(params: CrewConversationListParams): Promise<CrewConversation[]> {
    const { groupId } = crewConversationListParamsSchema.parse(params);
    await this.ready();
    return this.store.transaction(() => this.store.conversations(groupId));
  }
  async createConversation(params: CrewConversationCreateParams): Promise<CrewConversation> {
    const { groupId, name } = crewConversationCreateParamsSchema.parse(params);
    await this.ready();
    return this.store.transaction(() => this.store.createConversation(groupId, name));
  }
  async deleteConversation(params: CrewConversationDeleteParams): Promise<void> {
    const { groupId, conversationId } = crewConversationDeleteParamsSchema.parse(params);
    await this.ready();
    this.store.transaction(() => this.store.deleteConversation(groupId, conversationId));
  }
  async get(params: CrewGetParams): Promise<CrewGroupDetail> {
    const { groupId, conversationId } = crewGetParamsSchema.parse(params);
    await this.ready();
    return readCrewGroupDetail(this.store, this.options.runtime, { groupId, conversationId });
  }
  async create(params: CrewCreateParams): Promise<CrewGroup> {
    const input = crewCreateParamsSchema.parse(params),
      members = membersWithIds(input.members);
    await this.ready();
    return this.store.transaction(() => this.store.create(input.name, members, input));
  }
  async update(params: CrewUpdateParams): Promise<CrewGroup> {
    const input = crewUpdateParamsSchema.parse(params);
    await this.ready();
    const updated = this.store.transaction(() => {
      const group = this.store.group(input.groupId);
      if (input.members) this.store.assertIdle(input.groupId);
      return this.store.update(
        input.groupId,
        input.name ?? group.name,
        input.members ? membersWithIds(input.members) : undefined,
        input,
      );
    });
    if (input.relayPaused === false)
      for (const conversation of this.store.conversations(input.groupId))
        this.schedule(input.groupId, conversation.conversationId);
    return updated;
  }
  async delete(params: CrewDeleteParams): Promise<void> {
    const { groupId } = crewDeleteParamsSchema.parse(params);
    await this.ready();
    this.store.transaction(() => this.store.delete(groupId));
  }
  async duplicate(params: CrewDuplicateParams): Promise<CrewGroup> {
    const input = crewDuplicateParamsSchema.parse(params);
    await this.ready();
    return this.store.transaction(() => {
      const group = this.store.group(input.groupId);
      return this.store.create(
        input.name ?? group.name,
        group.members.map((member) => ({
          ...member,
          memberId: randomUUID(),
          // 复制只继承当前有效权限，避免旧 write 覆写在资产降权后阻断安全复制。
          ...(member.accessMode ? { accessMode: this.store.resolve(member).accessMode } : {}),
        })),
        group,
      );
    });
  }
  async bind(params: CrewBindParams): Promise<CrewGroup> {
    const { groupId, binding } = crewBindParamsSchema.parse(params);
    await this.ready();
    if (!isAbsolute(binding.workspacePath) && !win32.isAbsolute(binding.workspacePath))
      throw new Error("crew.absolutePathRequired");
    const group = this.store.transaction(() => {
      this.store.assertIdle(groupId);
      return this.store.group(groupId);
    });
    // 目录/权限/远端身份由平台端口预检；await 后锁内复查 epoch 与未决执行，防止预检期间重绑或派工。
    await this.options.runtime.preflight(binding);
    return this.store.transaction(() => this.store.bind(groupId, binding, group.epoch));
  }
  async send(params: CrewSendParams): Promise<CrewSendResult> {
    const input = crewSendParamsSchema.parse(params);
    await this.ready();
    const group = this.store.group(input.groupId);
    const existing = this.store
      .messages(input.groupId, input.conversationId)
      .some((message) => message.messageId === input.messageId);
    const reference = group.members.find((candidate) => candidate.memberId === input.mentions[0]);
    const member = !existing && reference ? this.store.resolve(reference) : undefined;
    if (!existing && member && member.runtime !== "zcode" && group.workspaceBinding) {
      const probe = await this.options.runtime.probeMember?.(group.workspaceBinding, member);
      if (!probe?.available) throw new Error("crew.runtimeUnavailable");
    }
    const result = this.store.transaction(() => {
      const current = this.store.group(input.groupId);
      // preflight 期间配置或目录变更必须重试，不能把旧能力检查授权给新成员快照。
      if (
        !existing &&
        (current.epoch !== group.epoch ||
          JSON.stringify(current.members) !== JSON.stringify(group.members) ||
          (member && JSON.stringify(this.store.resolve(reference!)) !== JSON.stringify(member)))
      )
        throw new Error("crew.staleExecution");
      return this.store.enqueue(input);
    });
    if (result.execution?.status === "queued")
      this.schedule(input.groupId, result.execution.conversationId);
    return result;
  }
  async recover(params: CrewRecoverParams): Promise<CrewGroupDetail> {
    const { groupId, conversationId, confirm } = crewRecoverParamsSchema.parse(params);
    await this.ready();
    const recovering = this.store.conversation(groupId, conversationId);
    if (recovering.status === "recovery_required")
      this.store.transaction(() =>
        invalidateCrewRelayAdmissions(this.store.db, groupId, recovering.conversationId),
      );
    for (const execution of this.executionStore.running(groupId, conversationId)) {
      // owner 存活或无法证明死亡就不抢占；CAS 防止异步存活检查覆盖并发完成的任务。
      if (execution.ownerId && (await this.options.isOwnerAlive(execution.ownerId))) continue;
      this.executionStore.recovery(execution);
    }
    // confirm=false（服务重启自动恢复）只探测归属，保持未决等人处理；
    // confirm=true（用户显式点「检查恢复」）= 人工确认归属：owner 已死亡或无法
    // 证明存活的未决执行被安全放弃（cancelled，绝不重放已创建 task 的输入），
    // 会话解锁可再次派工；owner 仍存活 → 保持 recovery_required 等 owner 收敛。
    if (confirm) {
      for (const execution of this.executionStore.recoveryRequired(groupId, conversationId)) {
        // Bugfix：isOwnerAlive 对本进程创建的执行恒为 true（crewOwner 是进程级单例），
        // 会把「自己已中断的执行」误判为存活而永远无法确认。处于 recovery_required
        // 的本进程执行必然已退出执行队列（execute 的 catch/finally 标记），确认安全。
        const ownedByThisProcess = execution.ownerId === this.options.ownerId;
        if (
          !ownedByThisProcess &&
          execution.ownerId &&
          (await this.options.isOwnerAlive(execution.ownerId))
        )
          continue;
        this.executionStore.finish(execution, "cancelled", "crew.recovered");
        // 清理准入层的 interrupted entry 与孤儿进程组，否则该工作目录的
        // 新派工会被 crew.recoveryRequired 永久拦截（用户看到连续恢复态）。
        await this.options.runtime.confirmRecovery?.(execution.workspaceBinding);
      }
    }
    const detail = this.store.transaction(() => this.store.detail(groupId, conversationId));
    if (detail.executions.some((execution) => execution.status === "queued"))
      this.schedule(groupId, detail.conversation.conversationId);
    return detail;
  }
  async cancel(params: CrewCancelParams): Promise<CrewExecution> {
    const { groupId, conversationId, executionId } = crewCancelParamsSchema.parse(params);
    await this.ready();
    const execution = this.store.execution(executionId);
    const conversation = this.store.conversation(groupId, conversationId);
    if (execution.groupId !== groupId || execution.conversationId !== conversation.conversationId)
      throw new Error("crew.executionNotFound");
    if (["succeeded", "failed", "cancelled"].includes(execution.status))
      return this.store.transaction(() => this.relay.records.cancel(execution));
    this.store.transaction(() => this.relay.records.requestCancel(execution));
    if (execution.status !== "queued") {
      if (!execution.taskId) throw new Error("crew.taskNotReady");
      // 取消成功必须表示安全停止；端口失败时保留原未决状态，不能提前放行重绑/成员修改。
      try {
        await this.options.runtime.cancel(execution.workspaceBinding, execution.taskId);
      } catch (error) {
        if (error instanceof Error && error.message === "crew.recoveryRequired")
          this.executionStore.recovery(execution);
        throw error;
      }
    }
    const result = this.executionStore.finish(execution, "cancelled", "crew.cancelled");
    this.store.transaction(() => this.relay.records.cancel(result));
    this.schedule(groupId, execution.conversationId);
    return result;
  }
  async respondRelay(params: CrewRelayParams): Promise<CrewExecution> {
    await this.ready();
    const execution = await this.relay.respond(params);
    if (execution.relay?.status === "dispatched")
      this.schedule(execution.groupId, execution.conversationId);
    return execution;
  }
  async respondPermission(params: CrewPermissionParams): Promise<CrewExecution> {
    await this.ready();
    return respondCrewPermission(this.store, this.options.runtime, params, (input) =>
      this.cancel(input),
    );
  }
  private schedule(groupId: string, conversationId: string): void {
    if (this.closed) return;
    // 调度与恢复按会话分区；工作目录互斥仍由 runtime 的全局 workspace 租约保证。
    const key = JSON.stringify([groupId, conversationId]);
    if (this.jobs.has(key)) {
      this.requested.add(key);
      return;
    }
    const job = this.drain(groupId, conversationId)
      .catch(() => {
        // 不记录端口异常原文，避免把工作目录凭据或模型正文写入生产日志。
        log.warn(undefined, "Crew dispatch interrupted; persisted execution requires recovery", {
          groupId,
          conversationId,
        });
      })
      .finally(() => {
        this.jobs.delete(key);
        if (this.requested.delete(key)) this.schedule(groupId, conversationId);
      });
    this.jobs.set(key, job);
  }
  private async drain(groupId: string, conversationId: string): Promise<void> {
    await this.ready();
    while (!this.closed) {
      const execution = this.executionStore.claim(groupId, conversationId);
      if (!execution) return;
      await this.execute(execution);
    }
  }
  private async execute(execution: CrewExecution): Promise<void> {
    const deadline = new CrewExecutionDeadline(
      this.store,
      this.executionStore,
      this.relay.records,
      this.options.runtime,
    );
    try {
      const stopped = this.relay.records.admissionReason(execution);
      if (stopped) {
        this.executionStore.finish(execution, "cancelled", `crew.${stopped}`);
        return;
      }
      await this.options.runtime.preflight(execution.workspaceBinding);
      if (this.closed) {
        this.executionStore.unclaim(execution);
        return;
      }
      const current = this.store.execution(execution.executionId);
      if (current.status !== "running" || current.ownerId !== this.options.ownerId) return;
      const group = this.store.group(execution.groupId);
      if (group.epoch !== execution.epoch) {
        this.executionStore.recovery(execution);
        return;
      }
      const resolvedMembers = group.members.map((member) => this.store.resolve(member));
      const result = await this.options.runtime.execute({
        group,
        member: execution.memberSnapshot,
        execution,
        messages: this.store.context(execution),
        relayMembers: resolvedMembers.map((member) => member.name),
        relayMemberProfiles: resolvedMembers.map((member) => ({
          name: member.name,
          role: member.rolePrompt.slice(0, 500),
        })),
        // 候选仅来自本对话；跨对话复用已完成 task 会把 vendor 原生历史带入新任务。
        resumeTaskId:
          this.store
            .executions(execution.groupId, execution.conversationId)
            .filter(
              (prior) =>
                prior.status === "succeeded" &&
                prior.taskId &&
                prior.epoch === execution.epoch &&
                prior.memberId === execution.memberId &&
                JSON.stringify(prior.memberSnapshot) === JSON.stringify(execution.memberSnapshot),
            )
            .at(-1)?.taskId ?? undefined,
        onTaskCreated: async (taskId) => {
          const checked = crewGetParamsSchema.shape.groupId.parse(taskId);
          this.executionStore.taskCreated(execution, checked);
          const reason = this.relay.records.admissionReason(execution);
          if (reason) throw new Error(`crew.${reason}`);
          if (this.closed) throw new Error("crew.recoveryRequired");
          deadline.arm(this.store.execution(execution.executionId));
        },
      });
      const saved = this.store.execution(execution.executionId);
      if (saved.status !== "running" || saved.ownerId !== this.options.ownerId) return;
      if (
        !saved.taskId ||
        saved.taskId !== result.taskId ||
        typeof result.text !== "string" ||
        !["succeeded", "failed", "cancelled"].includes(result.status)
      ) {
        this.executionStore.recovery(execution);
        return;
      }
      const finished = this.executionStore.finish(execution, result.status, result.text, (saved) =>
        this.relay.records.propose(saved, result.text),
      );
      if (finished.status === "succeeded") await this.relay.advance(finished.executionId);
    } catch (error) {
      const current = this.store.execution(execution.executionId);
      if (current.status !== "running" || current.ownerId !== this.options.ownerId) return;
      // Bugfix：此兜底分支此前无日志，preflight/execute 的原始失败被吞成
      // recovery_required，线上永远只能看到「待确认恢复」无法定位。补结构化现场。
      log.warn(undefined, "crew 执行失败，按错误类型分类处理", {
        event: "crew.runtime.execute_failed",
        module: "agent-crew",
        executionId: execution.executionId,
        workspacePath: execution.workspaceBinding?.workspacePath,
        error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
      });
      // workspaceBusy 是端口保证尚未发送输入的明确准入拒绝；即使已建 task 也可安全失败。
      // 未知 ACK、存储或进程异常不能证明没有写入，统一保留恢复隔离。
      if (
        error instanceof Error &&
        ["crew.relayCancelled", "crew.relayBudgetExceeded"].includes(error.message)
      )
        this.executionStore.finish(current, "cancelled", error.message);
      else if (
        error instanceof Error &&
        [
          "crew.workspaceBusy",
          "crew.runtimeUnavailable",
          "crew.promptTooLarge",
          // 预留任务归属在创建会话之前被拒，确定没有投递任何输入；不能留成恢复态。
          "project.remote-project-required",
          "project.cwd-not-in-roots",
          "project.remote-single-root-required",
        ].includes(error.message)
      )
        this.executionStore.finish(current, "failed", error.message);
      else this.executionStore.recovery(current);
    } finally {
      await deadline.close();
    }
  }
  /** 测试/宿主关闭时等待已启动派工；正常 RPC send 不等待模型完成。 */
  async whenIdle(): Promise<void> {
    while (this.jobs.size) await Promise.all(this.jobs.values());
  }
  async dispose(): Promise<void> {
    this.closed = true;
    this.requested.clear();
    await this.whenIdle();
    await this.store.shutdown();
  }
}
