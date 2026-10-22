import { invalidateCrewRelayAdmissions } from "./crewRelayControl.js";
import { randomUUID } from "node:crypto";
import type { CrewExecution } from "@zcode/shared";
import { CrewStore, readExecution } from "./crewStore.js";
import { isCrewPass } from "./crewRelayPolicy.js";

/** 状态更新必须携带旧 owner/status/epoch；旧结果不能覆盖恢复或新绑定纪元。 */
export class CrewExecutionStore {
  constructor(
    private readonly store: CrewStore,
    private readonly ownerId: string,
  ) {}

  claim(groupId: string, conversationId?: string): CrewExecution | null {
    return this.store.transaction(() => {
      const conversation = this.store.conversation(groupId, conversationId);
      const db = this.store.db;
      const row = db
        .prepare(`SELECT e.* FROM agent_crew_executions e JOIN agent_crew_groups g ON g.group_id=e.group_id
        WHERE e.group_id=? AND e.conversation_id=? AND e.status='queued' AND e.epoch=g.epoch
        AND (e.hop=0 OR g.relay_paused=0)
        AND NOT EXISTS(SELECT 1 FROM agent_crew_executions busy WHERE busy.group_id=e.group_id AND busy.conversation_id=e.conversation_id AND busy.status IN ('running','recovery_required'))
        ORDER BY e.created_at,e.rowid LIMIT 1`)
        .get(groupId, conversation.conversationId);
      if (!row) return null;
      const updated = db
        .prepare(
          "UPDATE agent_crew_executions SET status='running',owner_id=?,updated_at=? WHERE execution_id=? AND status='queued' AND epoch=?",
        )
        .run(this.ownerId, Date.now(), String(row.execution_id), Number(row.epoch));
      return updated.changes === 1 ? this.store.execution(String(row.execution_id)) : null;
    });
  }
  unclaim(execution: CrewExecution): void {
    // 只允许尚未调用 execute 的关闭路径退回 queued，绝不回放已创建 task 的输入。
    this.store.db
      .prepare(`UPDATE agent_crew_executions SET status='queued',owner_id=NULL,updated_at=?
      WHERE execution_id=? AND status='running' AND owner_id=? AND task_id IS NULL AND epoch=?`)
      .run(Date.now(), execution.executionId, this.ownerId, execution.epoch);
  }
  taskCreated(execution: CrewExecution, taskId: string): void {
    this.store.transaction(() => {
      const updated = this.store.db
        .prepare(`UPDATE agent_crew_executions SET task_id=?,updated_at=?
        WHERE execution_id=? AND status='running' AND owner_id=? AND epoch=? AND (task_id IS NULL OR task_id=?)
        AND epoch=(SELECT epoch FROM agent_crew_groups WHERE group_id=?)`)
        .run(
          taskId,
          Date.now(),
          execution.executionId,
          this.ownerId,
          execution.epoch,
          taskId,
          execution.groupId,
        );
      if (updated.changes !== 1) throw new Error("crew.staleExecution");
    });
  }
  recovery(execution: CrewExecution): void {
    this.store.transaction(() => {
      const result = this.store.db
        .prepare(`UPDATE agent_crew_executions SET status='recovery_required',updated_at=?
        WHERE execution_id=? AND status='running' AND owner_id IS ? AND epoch=?`)
        .run(Date.now(), execution.executionId, execution.ownerId, execution.epoch);
      if (result.changes === 1)
        invalidateCrewRelayAdmissions(this.store.db, execution.groupId, execution.conversationId);
    });
  }

  finish(
    execution: CrewExecution,
    status: "succeeded" | "failed" | "cancelled",
    text: string,
    onSuccess?: (execution: CrewExecution) => void,
  ): CrewExecution {
    return this.store.transaction(() => {
      const result = this.store.db
        .prepare(`UPDATE agent_crew_executions SET status=?,updated_at=?
        WHERE execution_id=? AND status=? AND owner_id IS ? AND epoch=?
        AND epoch=(SELECT epoch FROM agent_crew_groups WHERE group_id=?)`)
        .run(
          status,
          Date.now(),
          execution.executionId,
          execution.status,
          execution.ownerId,
          execution.epoch,
          execution.groupId,
        );
      // 成功但明确 [PASS]：执行收口，不写群板，也不触发下一跳接力。
      const passed = status === "succeeded" && isCrewPass(text);
      if (result.changes === 1 && !passed)
        this.store.insertMessage({
          groupId: execution.groupId,
          conversationId: execution.conversationId,
          messageId: randomUUID(),
          epoch: execution.epoch,
          sender: "member",
          memberId: execution.memberId,
          mentions: [],
          executionId: execution.executionId,
          text: text.slice(0, 64000),
        });
      const saved = this.store.execution(execution.executionId);
      if (result.changes === 1 && status === "succeeded" && !passed) onSuccess?.(saved);
      return this.store.execution(execution.executionId);
    });
  }
  running(groupId: string, conversationId?: string): CrewExecution[] {
    const conversation = this.store.conversation(groupId, conversationId);
    return this.store.db
      .prepare(
        "SELECT * FROM agent_crew_executions WHERE group_id=? AND conversation_id=? AND status='running'",
      )
      .all(groupId, conversation.conversationId)
      .map(readExecution);
  }

  /** 待人工检查归属的执行；检查恢复语义必须能看到它们，否则确认按钮永远空转。 */
  recoveryRequired(groupId: string, conversationId?: string): CrewExecution[] {
    const conversation = this.store.conversation(groupId, conversationId);
    return this.store.db
      .prepare(
        "SELECT * FROM agent_crew_executions WHERE group_id=? AND conversation_id=? AND status='recovery_required'",
      )
      .all(groupId, conversation.conversationId)
      .map(readExecution);
  }
}
