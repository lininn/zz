import type { IDisposable } from "@zcode/rpc";
import {
  applyConversationDelta,
  conversationTopicFrameSchema,
  TopicWireFrameAssembler,
  type ConversationSnapshot,
  type ConversationTopicWireCandidate,
} from "@zcode/shared/zcode-protocol-v4";
import type { IZCodeAgentService, ZCodeAgentSessionTarget } from "#src/zcode-agent/zcodeAgent.js";

/** 只消费权威投影；有队列、后台工作、接力目标或权限等待时不允许交出工作目录。 */
export function isCrewWorkspaceQuiescent(snapshot: ConversationSnapshot): boolean {
  return (
    ["draft", "completedSuccess", "completedInterrupted", "error"].includes(
      snapshot.control.phase,
    ) &&
    snapshot.control.activeWorks.length === 0 &&
    !snapshot.rows.window.some((row) => row.kind === "turnHeader" && row.state === "running") &&
    snapshot.pendingInteractions.length === 0 &&
    snapshot.queue.items.length === 0 &&
    !snapshot.backgroundWorks.some(
      (work) => work.status === "running" || work.status === "resultPending",
    ) &&
    !snapshot.subagents?.running.length &&
    snapshot.goal?.status !== "active" &&
    snapshot.goal?.status !== "verifying"
  );
}

export class CrewAdmissionMonitor {
  snapshot: ConversationSnapshot | undefined;
  private subscriptionId?: string;
  private readonly assembler = new TopicWireFrameAssembler(conversationTopicFrameSchema);
  private listener?: IDisposable;
  private pending: ConversationTopicWireCandidate[] = [];
  private resolveInitial?: () => void;
  private rejectInitial?: (error: Error) => void;
  private closed = false;
  private epoch?: string;
  private highestSeq = -1;
  private repairing = false;

  constructor(
    private readonly agent: IZCodeAgentService,
    private readonly target: ZCodeAgentSessionTarget,
    private readonly onSnapshot: () => void,
  ) {}

  async start(): Promise<void> {
    const initial = new Promise<void>((resolve, reject) => {
      this.resolveInitial = resolve;
      this.rejectInitial = reject;
    });
    void initial.catch(() => {});
    // 先订阅再拿 ACK；initial 是 ACK 后通知，不能漏掉 ACK promise 恢复之前到达的首帧。
    this.listener = this.agent.onDynamicConversationFrame(this.target)((wire) => {
      if (this.closed || wire.topic !== `conversation/${this.target.sessionId}`) return;
      if (!this.subscriptionId) {
        if (this.pending.length < 128) this.pending.push(wire);
        else this.rejectInitial?.(new Error("crew.recoveryRequired"));
        return;
      }
      this.accept(wire);
    });
    try {
      const { ack } = await this.agent.subscribeConversationV4({
        ...this.target,
        visibility: "background",
        subscriberScope: "agent-crew-admission",
      });
      this.subscriptionId = ack.subscriptionId;
      for (const wire of this.pending) this.accept(wire);
      this.pending = [];
      await initial;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private accept(wire: ConversationTopicWireCandidate): void {
    if (wire.subscriptionId !== this.subscriptionId) return;
    for (const event of this.assembler.accept(wire)) {
      if (event.kind === "fault") {
        // 丢帧只能撤销安全证明，不能根据旧 idle 投影释放租约。
        this.snapshot = undefined;
        this.rejectInitial?.(new Error("crew.recoveryRequired"));
        this.repair();
        continue;
      }
      const frame = event.frame;
      if (frame.payload.kind === "snapshot") {
        const next = frame.payload.snapshot;
        if (next.seq !== frame.toSeq || next.sessionId !== this.target.sessionId) {
          this.snapshot = undefined;
          continue;
        }
        // 延迟旧快照不能把正在写入的新状态还原成 idle；换代也不证明旧进程已安全退出。
        if (this.epoch && this.epoch !== next.logEpoch) {
          this.snapshot = undefined;
          continue;
        }
        if (next.seq < this.highestSeq) continue;
        this.epoch = next.logEpoch;
        this.snapshot = next;
      } else {
        if (!this.snapshot || frame.fromSeq !== this.snapshot.seq) {
          this.snapshot = undefined;
          this.repair();
          continue;
        }
        for (const delta of frame.payload.deltas)
          this.snapshot = applyConversationDelta(this.snapshot, delta);
        this.snapshot = { ...this.snapshot, seq: frame.toSeq };
      }
      this.highestSeq = Math.max(this.highestSeq, this.snapshot.seq);
      this.resolveInitial?.();
      this.resolveInitial = undefined;
      this.rejectInitial = undefined;
      this.onSnapshot();
    }
  }

  private repair(): void {
    if (this.closed || this.repairing || !this.subscriptionId) return;
    this.repairing = true;
    void this.agent
      .resyncConversationV4({
        ...this.target,
        subscriptionId: this.subscriptionId,
        base: null,
        forceSnapshot: true,
        runtimePolicy: "existing-only",
      })
      .catch(() => {
        /* 无新快照就保留隔离，不能按超时推断安全。 */
      })
      .finally(() => {
        this.repairing = false;
      });
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectInitial?.(new Error("crew.recoveryRequired"));
    this.listener?.dispose();
    this.assembler.clear();
    this.pending = [];
    if (this.subscriptionId) {
      void this.agent
        .unsubscribeConversationV4({
          ...this.target,
          subscriptionId: this.subscriptionId,
          runtimePolicy: "existing-only",
        })
        .catch(() => {
          /* 失联时由 runtime 生命周期清理，绝不据此释放租约。 */
        });
    }
  }
}
