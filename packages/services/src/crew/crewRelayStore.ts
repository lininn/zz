import type { CrewExecution, CrewRelay, CrewResolvedMember } from "@zcode/shared";
import { readExecution, type CrewStore } from "./crewStore.js";
import { crewObjectiveHash, parseCrewHandoff } from "./crewRelayPolicy.js";

type Reason = NonNullable<CrewRelay["reason"]>;

/** 使用既有 execution 行保存交接，不持有第二份内存队列。调用者在 CrewStore 写锁内使用。 */
export class CrewRelayStore {
  constructor(readonly store: CrewStore) {}

  save(execution: CrewExecution, relay: CrewRelay): CrewExecution {
    this.store.db
      .prepare(`UPDATE agent_crew_executions SET relay_json=?,updated_at=?
      WHERE execution_id=? AND status='succeeded' AND epoch=?
      AND json_extract(relay_json,'$.status') IS ?`)
      .run(
        JSON.stringify(relay),
        Date.now(),
        execution.executionId,
        execution.epoch,
        execution.relay?.status ?? null,
      );
    return this.store.execution(execution.executionId);
  }
  block(execution: CrewExecution, reason: Reason): CrewExecution {
    return execution.relay
      ? this.save(execution, { ...execution.relay, status: "blocked", reason })
      : execution;
  }
  propose(execution: CrewExecution, finalText: string): void {
    const handoff = parseCrewHandoff(finalText);
    if (!handoff || execution.relay || execution.status !== "succeeded") return;
    const targets = this.store
      .group(execution.groupId)
      .members.map((member) => this.store.resolve(member))
      .filter((member) => member.name === handoff.to);
    const relay: CrewRelay = {
      ...handoff,
      kind: (execution.hop ?? 0) === 0 ? "plan" : "handoff",
      status: "awaiting_user_approval",
      ...(targets.length === 1 ? { toMemberId: targets[0]!.memberId } : {}),
    };
    const saved = this.save(execution, relay);
    const reason = this.reason(saved);
    if (reason) this.block(saved, reason);
  }
  root(execution: CrewExecution): string {
    return execution.rootRequestId ?? execution.messageId;
  }
  chain(execution: CrewExecution): CrewExecution[] {
    return this.store.db
      .prepare(`SELECT * FROM agent_crew_executions
      WHERE group_id=? AND conversation_id=? AND root_request_id=? ORDER BY created_at,rowid`)
      .all(execution.groupId, execution.conversationId, this.root(execution))
      .map(readExecution);
  }
  deadline(execution: CrewExecution): number {
    const first = this.chain(execution).find((item) => (item.hop ?? 0) === 0);
    return (
      (first?.createdAt ?? execution.createdAt) +
      (first?.relayBudgetMinutes ?? execution.relayBudgetMinutes ?? 30) * 60000
    );
  }
  target(execution: CrewExecution): CrewResolvedMember | undefined {
    const group = this.store.group(execution.groupId);
    const reference = group.members.find(
      (member) => member.memberId === execution.relay?.toMemberId,
    );
    if (!reference) return;
    const member = this.store.resolve(reference);
    // 名字变化/重名不能将已批准的目标默默换成另一成员。
    const matches = group.members.filter(
      (item) => this.store.resolve(item).name === execution.relay?.to,
    );
    return member.name === execution.relay?.to && matches.length === 1 ? member : undefined;
  }
  admissionReason(execution: CrewExecution): Reason | undefined {
    if (
      this.store.db
        .prepare(`SELECT 1 FROM agent_crew_executions WHERE group_id=?
      AND conversation_id=? AND root_request_id=? AND relay_cancel_requested=1`)
        .get(execution.groupId, execution.conversationId, this.root(execution))
    )
      return "relayCancelled";
    if (Date.now() >= this.deadline(execution)) return "relayBudgetExceeded";
  }
  requestCancel(execution: CrewExecution): void {
    this.store.db
      .prepare("UPDATE agent_crew_executions SET relay_cancel_requested=1 WHERE execution_id=?")
      .run(execution.executionId);
  }
  reason(execution: CrewExecution): Reason | undefined {
    const group = this.store.group(execution.groupId);
    if (group.epoch !== execution.epoch) return "relayBindingChanged";
    if (
      this.store.conversation(execution.groupId, execution.conversationId).status ===
      "recovery_required"
    )
      return "relayRecoveryRequired";
    const admission = this.admissionReason(execution);
    if (admission) return admission;
    const chain = this.chain(execution);
    if (chain.some((item) => item.status === "cancelled")) return "relayCancelled";
    if (chain.some((item) => item.status === "failed")) return "relayFailed";
    if ((execution.hop ?? 0) >= 8) return "relayHopLimit";
    if (Date.now() >= this.deadline(execution)) return "relayBudgetExceeded";
    if (!execution.relay || !this.target(execution)) return "relayMemberNotFound";
    const duplicate = this.store.db
      .prepare(`SELECT 1 FROM agent_crew_executions
      WHERE group_id=? AND conversation_id=? AND root_request_id=? AND member_id=? AND relay_objective_hash=?`)
      .get(
        execution.groupId,
        execution.conversationId,
        this.root(execution),
        execution.relay.toMemberId!,
        crewObjectiveHash(execution.relay.objective),
      );
    if (duplicate) return "relayDuplicate";
  }
  /** 显式取消也要关闭待交接窗口，否则稍后到达的 probe 仍可能派工。 */
  cancel(execution: CrewExecution): CrewExecution {
    this.requestCancel(execution);
    for (const item of this.chain(execution)) {
      if (item.relay?.status === "awaiting_user_approval") this.block(item, "relayCancelled");
    }
    return this.store.execution(execution.executionId);
  }
}
