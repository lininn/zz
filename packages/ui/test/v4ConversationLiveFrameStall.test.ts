// 运行中帧静默看门狗。
//
// 线上现象（2026-10-29 15:00-15:16 本地）：后端 turn 在 07:05:51Z 已经 turn.completed，
// 调度器的 sessions/publishers 计数随后全部归零，但 Web 面板一直显示「工作中 15 分 37 秒」，
// 只有手动刷新才能看到代码。store 的所有逻辑故障（断档、assembly fault、过期 ACK、
// runtime 换代）都有自愈路径，唯独「帧从此不再到达」不产生任何 fault：status 仍是 live，
// 投影停在最后一次收到的 running 态。这里补的就是这条防线。
import type {
  ConversationSnapshot,
  ConversationTopicFrame,
  SessionPhase,
  TopicFrameDeliveryKind,
  V4ConversationResyncResult,
  V4ConversationSubscribeResult,
} from "@zcode/shared/zcode-protocol-v4";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECT_STALL_TIMEOUT_MS,
  ConversationProjectionStore,
  LIVE_FRAME_STALL_GRACE_MS,
  RECOVERY_RPC_TIMEOUT_MS,
} from "@/v4/conversationProjectionStore.js";
import type { ConversationTransport } from "@/v4/transport.js";

const TOPIC = "conversation/s1";
const SUBSCRIPTION_ID = "sub-1";

function createSnapshot(
  overrides: {
    seq?: number;
    phase?: SessionPhase;
    canStop?: boolean;
    apiRetry?: unknown;
    pendingInteractions?: unknown[];
  } = {},
): ConversationSnapshot {
  return {
    protocolVersion: 1,
    sessionId: "s1",
    logEpoch: "epoch-1",
    seq: overrides.seq ?? 10,
    revision: 1,
    control: {
      phase: overrides.phase ?? "running",
      sessionEnded: false,
      canStop: overrides.canStop ?? true,
      stopState: "stoppable",
      stopTargetKind: "unknown",
      activeWorks: [],
      lastError: null,
      apiRetry: overrides.apiRetry ?? null,
    },
    inputRouting: { mode: "startNow" },
    config: {},
    usage: {},
    queue: { items: [] },
    pendingInteractions: overrides.pendingInteractions ?? [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: null,
    rows: { window: [], firstRowId: null },
  } as unknown as ConversationSnapshot;
}

function snapshotFrame(snapshot: ConversationSnapshot): ConversationTopicFrame {
  return {
    topic: TOPIC,
    subscriptionId: SUBSCRIPTION_ID,
    fromSeq: 0,
    toSeq: snapshot.seq,
    sentAt: "2026-10-29T07:05:51.970Z",
    payload: { kind: "snapshot", snapshot },
  } as unknown as ConversationTopicFrame;
}

function createHarness(
  options: { resync?: () => Promise<V4ConversationResyncResult> } = {},
) {
  const resync = vi.fn(
    async (params: { subscriptionId: string }): Promise<V4ConversationResyncResult> => ({
      ack: { subscriptionId: params.subscriptionId, mode: "resume", logEpoch: "epoch-1" },
    }),
  );
  const transport = {
    subscribe: vi.fn(
      async (): Promise<V4ConversationSubscribeResult> => ({
        ack: { subscriptionId: SUBSCRIPTION_ID, mode: "snapshot", logEpoch: "epoch-1" },
      }),
    ),
    activate: vi.fn(),
    resync: options.resync ? vi.fn(options.resync) : resync,
    unsubscribe: vi.fn(async () => {}),
    onAssemblyFault: vi.fn(() => () => {}),
    onRuntimeRestart: vi.fn(() => () => {}),
  } as unknown as ConversationTransport;
  const store = new ConversationProjectionStore(TOPIC, transport);
  const deliver = (
    frame: ConversationTopicFrame,
    deliveryKind: TopicFrameDeliveryKind = "initial",
  ) => store.handleFrame(frame, { deliveryKind });
  return { store, transport, deliver };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("运行中帧静默看门狗", () => {
  it("运行中超过静默窗口后发起 same-sub 恢复（不靠手动刷新）", async () => {
    vi.useFakeTimers();
    const { store, transport, deliver } = createHarness();
    await store.connect();
    deliver(snapshotFrame(createSnapshot({ seq: 10 })));

    // 静默窗口内不打扰正常流式输出。
    await vi.advanceTimersByTimeAsync(LIVE_FRAME_STALL_GRACE_MS - 1_000);
    expect(transport.resync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.resync).toHaveBeenCalledTimes(1);
    expect(transport.resync).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: SUBSCRIPTION_ID,
        base: { logEpoch: "epoch-1", seq: 10 },
      }),
    );
    await store.close();
  });

  it("终态帧到达后不再排期（完成态不能继续被判定为在跑）", async () => {
    vi.useFakeTimers();
    const { store, transport, deliver } = createHarness();
    await store.connect();
    deliver(snapshotFrame(createSnapshot({ seq: 10 })));
    deliver(
      snapshotFrame(createSnapshot({ seq: 11, phase: "completedSuccess", canStop: false })),
    );

    await vi.advanceTimersByTimeAsync(LIVE_FRAME_STALL_GRACE_MS * 4);
    expect(transport.resync).not.toHaveBeenCalled();
    await store.close();
  });

  it.each([
    ["provider 退避重试", { apiRetry: { attempt: 1 } }],
    ["等待用户授权", { pendingInteractions: [{}] }],
  ])("%s 期间的静默是预期行为，不触发恢复", async (_label, overrides) => {
    vi.useFakeTimers();
    const { store, transport, deliver } = createHarness();
    await store.connect();
    deliver(snapshotFrame(createSnapshot(overrides)));

    await vi.advanceTimersByTimeAsync(LIVE_FRAME_STALL_GRACE_MS * 3);
    expect(transport.resync).not.toHaveBeenCalled();
    await store.close();
  });

  it("已有投影后重建订阅无响应时超时落 error，不永久停在 connecting", async () => {
    vi.useFakeTimers();
    const { store, transport, deliver } = createHarness();
    await store.connect();
    deliver(snapshotFrame(createSnapshot({ seq: 10 })));

    // 第二次订阅永不返回：传输半开。
    (transport.subscribe as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise(() => {}),
    );
    void store.retry();
    await vi.advanceTimersByTimeAsync(CONNECT_STALL_TIMEOUT_MS - 1_000);
    expect(store.getState().status).toBe("connecting");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.getState().status).toBe("error");
    expect(store.getState().lastError).toContain("订阅重建超时");
    await store.close();
  });

  it("resync 永不返回时按 RPC 超时重建订阅，不把 store 永久卡在 recovery", async () => {
    vi.useFakeTimers();
    const { store, transport, deliver } = createHarness({
      resync: () => new Promise<V4ConversationResyncResult>(() => {}),
    });
    await store.connect();
    expect(transport.subscribe).toHaveBeenCalledTimes(1);
    deliver(snapshotFrame(createSnapshot({ seq: 10 })));

    // 传输半开：resync 既不发帧也不报错。
    await vi.advanceTimersByTimeAsync(LIVE_FRAME_STALL_GRACE_MS);
    expect(transport.resync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RECOVERY_RPC_TIMEOUT_MS);
    // 交给 connect 的既有错误/退避路径收口；此时至少已重新发起一次订阅。
    expect(transport.subscribe).toHaveBeenCalledTimes(2);
    expect(store.getState().status).toBe("live");
    await store.close();
  });
});
