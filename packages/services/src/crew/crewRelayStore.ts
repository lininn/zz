import type { CrewExecution, CrewHandoff, CrewRelay, CrewResolvedMember } from "@zcode/shared";
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
    if (!execution.relay) return execution;
    const saved = this.save(execution, { ...execution.relay, status: "blocked", reason });
    this.emitEvent(saved, "blocked", `error.${reason}`);
    return saved;
  }
  /** 事件只用确定性 ID 记录状态，不带 executionId，避免与成员回复的 UNIQUE 列冲突。 */
  private emitEvent(execution: CrewExecution, suffix: string, text: string): void {
    this.store.insertEvent({
      groupId: execution.groupId,
      conversationId: execution.conversationId,
      messageId: `crew-event-${execution.executionId}-${suffix}`,
      epoch: execution.epoch,
      memberId: execution.memberId,
      text,
      executionId: null,
    });
  }
  propose(execution: CrewExecution, finalText: string): void {
    if (execution.relay || execution.status !== "succeeded") return;
    // 交接不依赖任何单一格式，三条通道任一成立即派工：
    //   ① 结构化标签（JSON，容忍多余字段）→ ② 正文里的 @成员名 → ③ 兜底交回根规划者。
    // 外部 runtime（claude/codex）被 --json-schema 约束，弱模型普遍丢标签或写多余字段；
    // 链路存续不能押在「模型是否愿意吐出格式完美的 JSON」上。
    const handoff =
      parseCrewHandoff(finalText) ??
      this.mentionHandoff(execution, finalText) ??
      this.inferHandoff(execution, finalText);
    if (!handoff) return;
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
    if (reason) {
      this.block(saved, reason);
      return;
    }
    if (saved.relay?.status === "awaiting_user_approval")
      this.emitEvent(
        saved,
        "approval",
        saved.relay.kind === "plan" ? "relay.planTitle" : "relay.handoffTitle",
      );
  }
  /**
   * 正文 @成员名 通道：不要求任何 JSON，模型只要在回复里提到下一站成员即可。
   * 名字长的优先（避免「@前端」抢占「@前端 Codex」），同一次回复里取最后一次出现，
   * 与标签「只认最后一个」的语义一致。排除自己，避免自交。
   */
  private mentionHandoff(execution: CrewExecution, finalText: string): CrewHandoff | null {
    const members = this.store
      .group(execution.groupId)
      .members.map((member) => this.store.resolve(member))
      .filter((member) => member.memberId !== execution.memberId);
    let best: { index: number; member: CrewResolvedMember } | undefined;
    for (const member of members) {
      const index = finalText.lastIndexOf(`@${member.name}`);
      if (index < 0) continue;
      // 取「最后被提到」的成员；前缀重叠（@前端 vs @前端 Codex）同位置时取更长的名字。
      if (
        !best ||
        index > best.index ||
        (index === best.index && member.name.length > best.member.name.length)
      )
        best = { index, member };
    }
    if (!best) return null;
    return {
      to: best.member.name,
      objective: `接手「${execution.memberSnapshot.name}」的产出（第 ${(execution.hop ?? 0) + 1} 跳）`,
      context: finalText.slice(-6000) || "(无输出)",
    };
  }
  /**
   * 三通道都未命中时的兜底交接：hop>=1 的成员完成即交回根规划者。
   * 根规划者自己无标签时才是真正的链尾（返回 null，链结束）。
   * objective 带上 hop，让每跳的目标指纹唯一，避免被 relayDuplicate 误熔断；
   * 真正的循环由既有 hop<=8 上限兜住。
   */
  private inferHandoff(execution: CrewExecution, finalText: string): CrewHandoff | null {
    const hop = execution.hop ?? 0;
    if (hop === 0) return null;
    const root = this.chain(execution).find((item) => (item.hop ?? 0) === 0);
    if (!root || root.memberId === execution.memberId) return null;
    return {
      to: root.memberSnapshot.name,
      objective: `汇总「${execution.memberSnapshot.name}」的产出并决定下一步（任务链第 ${hop} 跳）`,
      context: finalText.slice(-6000) || "(无输出)",
    };
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
