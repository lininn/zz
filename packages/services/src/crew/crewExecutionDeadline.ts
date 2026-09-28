import type { CrewExecution } from "@zcode/shared";
import type { CrewRuntimePort } from "./contract.js";
import type { CrewStore } from "./crewStore.js";
import type { CrewExecutionStore } from "./crewExecutionStore.js";
import type { CrewRelayStore } from "./crewRelayStore.js";

/** 墙钟预算不是同步补丁：到期明确请求停止，未获停止证明仍沿用恢复隔离。 */
export class CrewExecutionDeadline {
  private timer?: ReturnType<typeof setTimeout>;
  private stopping?: Promise<void>;
  constructor(
    private readonly store: CrewStore,
    private readonly executions: CrewExecutionStore,
    private readonly relay: CrewRelayStore,
    private readonly runtime: CrewRuntimePort,
  ) {}
  arm(execution: CrewExecution): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.stopping = this.expire(execution).catch(() => {
          // IO等意外失败不能放行下一跳；持久化取消标记已在发起停止之前写入。
          this.executions.recovery(execution);
        });
      },
      Math.max(0, this.relay.deadline(execution) - Date.now()),
    );
    this.timer.unref();
  }
  private async expire(execution: CrewExecution): Promise<void> {
    const current = this.store.execution(execution.executionId);
    if (current.status !== "running" || current.ownerId !== execution.ownerId || !current.taskId)
      return;
    this.store.transaction(() => this.relay.requestCancel(current));
    try {
      await this.runtime.cancel(current.workspaceBinding, current.taskId);
      this.executions.finish(current, "cancelled", "crew.relayBudgetExceeded");
    } catch {
      this.executions.recovery(current);
    }
  }
  async close(): Promise<void> {
    clearTimeout(this.timer);
    await this.stopping;
  }
}
