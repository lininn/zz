import { Emitter } from "@zcode/rpc";
import {
  conversationSnapshotSchema,
  encodeTopicWireFrames,
  type ConversationSnapshot,
  type ConversationTopicFrame,
  type ConversationTopicWireCandidate,
  type CommandAck,
} from "@zcode/shared/zcode-protocol-v4";
import type { IZCodeAgentService } from "../src/zcode-agent/zcodeAgent.js";

export function snapshot(sessionId = "session", seq = 1): ConversationSnapshot {
  const allowed = { allowed: true };
  return conversationSnapshotSchema.parse({
    protocolVersion: 1,
    sessionId,
    logEpoch: "epoch",
    seq,
    revision: seq,
    control: {
      phase: "draft",
      sessionEnded: false,
      canStop: false,
      stopState: "idle",
      stopTargetKind: "unknown",
      activeWorks: [],
      lastError: null,
      apiRetry: null,
    },
    availability: Object.fromEntries(
      [
        "fork",
        "compact",
        "switchModelConfig",
        "setFollowupMode",
        "queueEdit",
        "sendQueuedNow",
        "pauseGoal",
        "resumeGoal",
      ].map((key) => [key, allowed]),
    ),
    inputRouting: { mode: "startNow" },
    config: { provider: "fixture", model: "fixture", thought: "", followupMode: "queue" },
    usage: {
      contextWindow: null,
      cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: null,
    rows: { window: [], hasOlder: false, totalCount: 0, firstRowId: 0 },
  });
}
export function fakeAgent() {
  const frames = new Emitter<ConversationTopicWireCandidate>();
  const subscriptions = new Map<string, string>();
  let ordinal = 0;
  let current = snapshot();
  let sendCount = 0;
  let rejection = false;
  function emit(next: ConversationSnapshot, overrideSubscription?: string) {
    next = {
      ...next,
      rows: {
        ...next.rows,
        window: next.rows.window.map((row) =>
          row.kind === "turnHeader" &&
          ["completedSuccess", "completedInterrupted", "error"].includes(next.control.phase)
            ? {
                ...row,
                state:
                  next.control.phase === "error"
                    ? "failed"
                    : (next.control.phase as "completedSuccess" | "completedInterrupted"),
              }
            : row,
        ),
      },
    };
    current = next;
    const subscriptionId = overrideSubscription ?? subscriptions.get(next.sessionId);
    if (!subscriptionId) return;
    const frame: ConversationTopicFrame = {
      topic: `conversation/${next.sessionId}`,
      subscriptionId,
      fromSeq: 0,
      toSeq: next.seq,
      sentAt: Date.now(),
      payload: { kind: "snapshot", snapshot: next },
    };
    for (const wire of encodeTopicWireFrames(frame, {
      topic: frame.topic,
      subscriptionId,
      logicalFrameId: `frame-${++ordinal}`,
      logicalFrameOrdinal: ordinal,
      deliveryKind: "online",
      measurePhysicalFrameBytes: (wire) => JSON.stringify(wire).length,
    }))
      frames.fire(wire);
  }
  const agent = {
    initialize: async () => ({ available: true }),
    getWorkspaceRuntimeIdentity: async () => ({ processId: 910001 }),
    onDynamicConversationFrame: () => frames.event,
    subscribeConversationV4: async ({ sessionId }: { sessionId: string }) => {
      const subscriptionId = `subscription-${sessionId}-${++ordinal}`;
      subscriptions.set(sessionId, subscriptionId);
      emit(current.sessionId === sessionId ? current : snapshot(sessionId)); // 故意在 ACK promise 之前发首帧，验证 pre-ACK 缓冲。
      return { ack: { subscriptionId } };
    },
    unsubscribeConversationV4: async () => {},
    sendConversationCommandV4: async (
      input: Parameters<IZCodeAgentService["sendConversationCommandV4"]>[0],
    ): Promise<CommandAck> => {
      sendCount++;
      if (!rejection)
        emit({
          ...current,
          seq: current.seq + 1,
          rows: {
            window: [
              {
                kind: "turnHeader",
                rowId: 1,
                turnId: "turn",
                createdAt: 1,
                createdAtSeq: 1,
                origin: "userInput",
                sourceCommandId: input.envelope.commandId,
                state: "running",
                startedAt: 1,
              },
            ],
            totalCount: 1,
            firstRowId: 1,
          },
          control: {
            ...current.control,
            phase: "running",
            activeWorks: [{ kind: "primaryTurn", startedAt: Date.now() }],
          },
        });
      return {
        commandId: "command",
        status: rejection ? "rejected" : "accepted",
        revisionAtDecision: 1,
      };
    },
  } as unknown as IZCodeAgentService;
  return {
    agent,
    frames,
    emit,
    setCurrent(next: ConversationSnapshot) {
      current = next;
    },
    subscriptions,
    get current() {
      return current;
    },
    get sendCount() {
      return sendCount;
    },
    reject() {
      rejection = true;
    },
  };
}
