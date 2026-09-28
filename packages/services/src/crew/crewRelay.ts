import { assertCrewCapabilities } from "./agentCatalogStore.js";
import { crewRelayParamsSchema, type CrewExecution, type CrewRelayParams } from "@zcode/shared";
import type { CrewRuntimePort } from "./contract.js";
import type { CrewStore } from "./crewStore.js";
import { CrewRelayStore } from "./crewRelayStore.js";
import { crewObjectiveHash, crewRelayMessageId, mayAutoRelay } from "./crewRelayPolicy.js";

/** CrewService 的交接决策；运行仍交由既有 enqueue/claim/execute 调度。 */
export class CrewRelay {
  readonly records: CrewRelayStore;
  constructor(
    private readonly store: CrewStore,
    private readonly runtime: CrewRuntimePort,
    private readonly closed: () => boolean,
  ) {
    this.records = new CrewRelayStore(store);
  }

  async respond(params: CrewRelayParams): Promise<CrewExecution> {
    const input = crewRelayParamsSchema.parse(params);
    const execution = this.store.transaction(() => {
      const current = this.store.execution(input.executionId);
      const conversation = this.store.conversation(input.groupId, input.conversationId);
      if (
        current.groupId !== input.groupId ||
        current.conversationId !== conversation.conversationId
      )
        throw new Error("crew.executionNotFound");
      if (!current.relay) throw new Error("crew.relayNotFound");
      if (current.relay.status === "blocked") return current;
      if (current.relay.status !== "awaiting_user_approval") {
        if ((current.relay.status === "dispatched") !== input.approved)
          throw new Error("crew.relayDecisionConflict");
        return current;
      }
      // 审批决定与读取同一写锁；跨Host拒绝不能覆盖刚完成的派工。
      return input.approved
        ? current
        : this.records.save(current, { ...current.relay, status: "rejected" });
    });
    if (!input.approved || execution.relay?.status !== "awaiting_user_approval") return execution;
    return this.advance(execution.executionId, true);
  }

  async advance(executionId: string, approved = false): Promise<CrewExecution> {
    const candidate = this.store.transaction(() => {
      const execution = this.store.execution(executionId);
      if (approved && execution.relay?.status === "rejected")
        throw new Error("crew.relayDecisionConflict");
      if (this.closed() || execution.relay?.status !== "awaiting_user_approval") return null;
      const group = this.store.group(execution.groupId);
      if (group.relayPaused) return null;
      if (
        !approved &&
        (execution.relay.kind === "plan" || !mayAutoRelay(group, (execution.hop ?? 0) + 1))
      )
        return null;
      const reason = this.records.reason(execution);
      if (reason) {
        this.records.block(execution, reason);
        return null;
      }
      return { execution, member: this.records.target(execution)! };
    });
    if (!candidate) return this.store.execution(executionId);
    let available = true;
    try {
      assertCrewCapabilities(candidate.member);
      await this.runtime.preflight(candidate.execution.workspaceBinding);
      const probe = await this.runtime.probeMember?.(
        candidate.execution.workspaceBinding,
        candidate.member,
      );
      available =
        candidate.member.runtime === "zcode"
          ? probe?.available !== false
          : probe?.available === true;
    } catch {
      // 准入前探测失败尚未发送输入；只熔断交接，不将未知异常正文写入群板。
      available = false;
    }
    return this.store.transaction(() => {
      const execution = this.store.execution(executionId);
      if (approved && execution.relay?.status === "rejected")
        throw new Error("crew.relayDecisionConflict");
      if (this.closed() || execution.relay?.status !== "awaiting_user_approval") return execution;
      const group = this.store.group(execution.groupId);
      const reason = this.records.reason(execution);
      if (reason) return this.records.block(execution, reason);
      if (
        (execution.relay.admissionRevision ?? 0) !==
        (candidate.execution.relay?.admissionRevision ?? 0)
      )
        return execution;
      if (group.relayPaused || (!approved && !mayAutoRelay(group, (execution.hop ?? 0) + 1)))
        return execution;
      // 预检只证明当时的runtime配置可用；目录晚改不能借用旧probe作为授权。
      if (
        !available ||
        JSON.stringify(this.records.target(execution)) !== JSON.stringify(candidate.member)
      )
        return this.records.block(execution, "relayRuntimeUnavailable");
      const relay = execution.relay;
      const rootRequestId = this.records.root(execution);
      const hop = (execution.hop ?? 0) + 1;
      this.store.enqueue(
        {
          groupId: execution.groupId,
          conversationId: execution.conversationId,
          messageId: crewRelayMessageId(rootRequestId, hop, relay.toMemberId!),
          text: `# Crew handoff\nFrom: ${execution.memberSnapshot.name}\nObjective: ${relay.objective}\n\nContext:\n${relay.context}`,
          mentions: [relay.toMemberId!],
        },
        { rootRequestId, hop, objectiveHash: crewObjectiveHash(relay.objective) },
      );
      return this.records.save(execution, { ...relay, status: "dispatched", automatic: !approved });
    });
  }
}
