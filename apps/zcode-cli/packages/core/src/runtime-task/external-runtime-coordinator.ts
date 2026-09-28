import {
  ExternalRuntimeTaskRequestSchema,
  type ExternalRuntimeDispatchResult,
  type ExternalRuntimeQueueRecord,
  type ExternalRuntimeQueueSnapshot,
  type ExternalRuntimeQueueStore,
  type ExternalRuntimeState,
  type ExternalRuntimeTaskRequest,
} from "@zcode/contracts";

export type {
  ExternalRuntimeDispatchResult,
  ExternalRuntimeQueueRecord,
  ExternalRuntimeQueueSnapshot,
  ExternalRuntimeQueueStore,
};

export interface ExternalRuntimeCoordinatorOptions {
  store: ExternalRuntimeQueueStore;
  execute: (
    entry: ExternalRuntimeQueueRecord,
    signal: AbortSignal,
  ) => Promise<ExternalRuntimeDispatchResult>;
  onUpdate?: (snapshot: ExternalRuntimeQueueSnapshot) => void | Promise<void>;
  now?: () => Date;
  maxParallel?: number;
}

const DEFAULT_MAX_PARALLEL = 3;

const TERMINAL_STATES: readonly ExternalRuntimeState[] = ["succeeded", "failed", "cancelled"];
const PAUSING_STATES: readonly ExternalRuntimeState[] = [
  "awaiting_permission",
  "needs_verification",
  "interrupted",
  "recovery_required",
  "runtime_unavailable",
  "protocol_error",
  "policy_violation",
  "apply_conflict",
  "workspace_unsupported",
  "waiting_for_integration",
  "stale_base",
  "merge_conflict",
  "failed",
  "cancelled",
];

function cloneSnapshot(snapshot: ExternalRuntimeQueueSnapshot): ExternalRuntimeQueueSnapshot {
  return structuredClone(snapshot);
}

export class ExternalRuntimeCoordinator {
  private snapshot: ExternalRuntimeQueueSnapshot = { version: 1, entries: [] };
  private loaded = false;
  private mutation = Promise.resolve();
  private pumpPromise: Promise<void> | null = null;
  private readonly active = new Map<string, { abort: AbortController; mode: "sequential" | "parallel" }>();
  private activeWaiters: Array<() => void> = [];
  private readonly cancelRequested = new Map<string, string>();
  private readonly now: () => Date;

  constructor(private readonly options: ExternalRuntimeCoordinatorOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async load(): Promise<ExternalRuntimeQueueSnapshot> {
    if (!this.loaded) {
      const stored = await this.options.store.load();
      if (stored) this.snapshot = stored;
      this.loaded = true;
    }
    return cloneSnapshot(this.snapshot);
  }

  /** Called only by an explicit leased start; never schedules or persists work. */
  async refreshFromStoreIfIdle(): Promise<boolean> {
    let refreshed = false;
    await this.mutate(async () => {
      const busy = () => this.active.size > 0 || this.pumpPromise !== null ||
        this.snapshot.entries.some((entry) => entry.permission !== undefined);
      if (busy()) return;
      const stored = await this.options.store.load();
      if (busy()) return;
      // 同 scope 可跨 Host 交接；空闲时先纳入其他 owner 的持久化结果，再执行下一次准入。
      this.snapshot = cloneSnapshot(stored ?? { version: 1, entries: [] });
      this.loaded = true;
      refreshed = true;
    });
    return refreshed;
  }

  async enqueue(requestInput: ExternalRuntimeTaskRequest): Promise<ExternalRuntimeQueueRecord> {
    await this.load();
    const request = ExternalRuntimeTaskRequestSchema.parse(requestInput);
    let record!: ExternalRuntimeQueueRecord;
    await this.mutate(() => {
      const existing = this.snapshot.entries.find(
        (entry) => entry.request.taskId === request.taskId && entry.request.attemptId === request.attemptId,
      );
      if (existing) {
        record = existing;
        return;
      }
      const timestamp = this.now().toISOString();
      record = {
        request,
        runtimeState: "queued",
        enqueuedAt: timestamp,
        updatedAt: timestamp,
        settled: false,
      };
      this.snapshot.entries.push(record);
      return this.persistAndNotify();
    });
    this.schedulePump();
    return cloneSnapshot({ version: 1, entries: [record] }).entries[0]!;
  }

  async cancel(taskId: string, reason = "cancelled by user"): Promise<void> {
    await this.load();
    const active = this.active.get(taskId);
    if (active) {
      this.cancelRequested.set(taskId, reason);
      active.abort.abort();
      // 取消请求不是停止证明；必须等待当前 attempt 的监督 finally 完成。
      while (this.active.has(taskId)) await this.waitForActiveChange();
      return;
    }
    let resumeQueue = false;
    await this.mutate(() => {
      const entry = this.snapshot.entries.find(
        (item) => item.request.taskId === taskId && !TERMINAL_STATES.includes(item.runtimeState),
      );
      if (!entry) return;
      const ownsPause =
        entry.pauseReason !== undefined && entry.pauseReason === this.snapshot.pauseReason;
      if (entry.runtimeState === "recovery_required") return;
      this.setEntryState(entry, "cancelled", reason);
      entry.settled = true;
      delete entry.permission;
      if (ownsPause) {
        this.snapshot.pauseReason = undefined;
        resumeQueue = true;
      }
      return this.persistAndNotify();
    });
    if (resumeQueue) this.schedulePump();
  }

  async updatePermission(
    taskId: string,
    attemptId: string,
    permission: ExternalRuntimeQueueRecord["permission"],
  ): Promise<void> {
    await this.mutate(() => {
      const entry = this.snapshot.entries.find(
        (item) => item.request.taskId === taskId && item.request.attemptId === attemptId,
      );
      if (!entry || !this.active.has(taskId)) return;
      entry.permission = permission;
      entry.runtimeState = permission ? "awaiting_permission" : "running";
      entry.updatedAt = this.now().toISOString();
      return this.persistAndNotify();
    });
  }

  isActive(taskId: string): boolean { return this.active.has(taskId); }

  async resume(): Promise<void> {
    await this.load();
    await this.mutate(() => {
      if (this.snapshot.entries.some((entry) => entry.runtimeState === "recovery_required")) {
        throw new Error("recovery_required: process stop must be proven before resuming this workspace queue");
      }
      this.snapshot.pauseReason = undefined;
      return this.persistAndNotify();
    });
    this.schedulePump();
  }

  async waitForIdle(): Promise<void> {
    while (this.pumpPromise || this.active.size > 0) {
      if (this.pumpPromise) await this.pumpPromise;
      else await this.waitForActiveChange();
    }
  }

  private schedulePump(): void {
    if (this.pumpPromise || this.snapshot.pauseReason) return;
    this.pumpPromise = this.pump().finally(() => {
      this.pumpPromise = null;
    });
  }

  async recover(options: { replayQueued?: boolean } = {}): Promise<void> {
    await this.load();
    await this.mutate(() => {
      for (const entry of this.snapshot.entries) {
        if (entry.runtimeState === "running" || entry.runtimeState === "preflight" || entry.runtimeState === "awaiting_permission" || (options.replayQueued === false && entry.runtimeState === "queued")) {
          this.setEntryState(entry, "recovery_required", "process stop cannot be proven after restart");
          entry.settled = false;
          delete entry.permission;
        }
      }
      // 重启后仍可能有旧进程占用 workspace；保留隔离，不能顺手派发后面的 queued。
      this.snapshot.pauseReason = this.snapshot.entries.find((entry) => entry.runtimeState === "recovery_required")?.pauseReason ?? this.snapshot.pauseReason;
      return this.persistAndNotify();
    });
    this.schedulePump();
  }

  private async pump(): Promise<void> {
    while (true) {
      if (this.snapshot.pauseReason) {
        if (this.active.size > 0) await this.waitForActiveChange();
        return;
      }
      const queued = this.snapshot.entries.filter((entry) => entry.runtimeState === "queued");
      if (queued.length === 0) {
        if (this.active.size > 0) await this.waitForActiveChange();
        return;
      }
      const activeHasSequential = [...this.active.values()].some((item) => item.mode === "sequential");
      const firstSequentialIndex = queued.findIndex(
        (entry) => (entry.request.executionMode ?? "sequential") === "sequential",
      );
      if (firstSequentialIndex === 0 || activeHasSequential) {
        if (this.active.size > 0) {
          await this.waitForActiveChange();
          continue;
        }
        await this.mutate(() => {
          this.setEntryState(queued[0]!, "running");
          return this.persistAndNotify();
        });
        await this.runActive(queued[0]!, "sequential");
        if (this.snapshot.pauseReason) return;
        continue;
      }
      const maxParallel = this.options.maxParallel ?? DEFAULT_MAX_PARALLEL;
      const candidates =
        firstSequentialIndex < 0 ? queued : queued.slice(0, firstSequentialIndex);
      const launch = candidates.slice(0, Math.max(0, maxParallel - this.active.size));
      if (launch.length === 0) {
        await this.waitForActiveChange();
        continue;
      }
      await this.mutate(() => {
        for (const entry of launch) this.setEntryState(entry, "running");
        return this.persistAndNotify();
      });
      for (const entry of launch) void this.runActive(entry, "parallel");
    }
  }

  private async runActive(
    entry: ExternalRuntimeQueueRecord,
    mode: "sequential" | "parallel",
  ): Promise<void> {
    if (entry.runtimeState === "cancelled") return;
    const abort = new AbortController();
    this.active.set(entry.request.taskId, { abort, mode });
    try {
      let result: ExternalRuntimeDispatchResult;
      try {
        result = await this.options.execute(cloneSnapshot({ version: 1, entries: [entry] }).entries[0]!, abort.signal);
      } catch (error) {
        result = {
          runtimeState: abort.signal.aborted ? "recovery_required" : "failed",
          settled: !abort.signal.aborted,
          structuredResult: false,
          pauseReason: error instanceof Error ? error.message : String(error),
        };
      }
      const cancelReason = this.cancelRequested.get(entry.request.taskId);
      if (cancelReason) {
        this.cancelRequested.delete(entry.request.taskId);
        if (result.runtimeState !== "recovery_required") result = { ...result, runtimeState: "cancelled", pauseReason: cancelReason };
      }
      const gated = this.applySuccessGate(entry.request, result);
      await this.mutate(() => {
        const current = this.snapshot.entries.find(
          (item) =>
            item.request.taskId === entry.request.taskId &&
            item.request.attemptId === entry.request.attemptId,
        );
        if (!current) return;
        this.setEntryState(current, gated.state, gated.pauseReason);
        if (result.nativeSessionId) current.nativeSessionId = result.nativeSessionId;
        if (result.summary) current.summary = result.summary;
        current.settled = result.settled !== false && gated.state !== "recovery_required";
        if (gated.state !== "awaiting_permission") delete current.permission;
        return this.persistAndNotify();
      });
    } finally {
      this.active.delete(entry.request.taskId);
      for (const resolve of this.activeWaiters.splice(0)) resolve();
    }
  }

  private applySuccessGate(
    request: ExternalRuntimeTaskRequest,
    result: ExternalRuntimeDispatchResult,
  ): { state: ExternalRuntimeState; pauseReason?: string } {
    if (result.runtimeState !== "succeeded") {
      return {
        state: result.runtimeState,
        pauseReason:
          result.pauseReason ??
          (PAUSING_STATES.includes(result.runtimeState)
            ? `task requires intervention: ${result.runtimeState}`
            : undefined),
      };
    }
    if (!result.structuredResult) {
      return { state: "protocol_error", pauseReason: "missing structured result" };
    }
    if (request.accessMode === "read") return { state: "succeeded" };
    if (!result.workspaceChanged) {
      return { state: "needs_verification", pauseReason: "write task made no change" };
    }
    if (result.verification === "failed") {
      return { state: "failed", pauseReason: "independent verification failed" };
    }
    // 显式跳过验证（含未配置验证命令）= 接受无独立验证收口；验收由 crew 的 PM review 承担。
    if (result.verification === "skipped") return { state: "succeeded" };
    if (result.verification !== "passed") {
      return { state: "needs_verification", pauseReason: "trusted independent verification is required" };
    }
    return { state: "succeeded" };
  }

  private setEntryState(entry: ExternalRuntimeQueueRecord, state: ExternalRuntimeState, pauseReason?: string): void {
    entry.runtimeState = state;
    entry.updatedAt = this.now().toISOString();
    if (pauseReason) entry.pauseReason = pauseReason;
    else delete entry.pauseReason;
    if (pauseReason && PAUSING_STATES.includes(state)) {
      this.snapshot.pauseReason = pauseReason;
    }
  }

  private mutate(operation: () => unknown): Promise<void> {
    const result = this.mutation.then(operation, operation);
    this.mutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result.then(() => undefined);
  }

  private async persistAndNotify(): Promise<void> {
    await this.options.store.save(cloneSnapshot(this.snapshot));
    await this.options.onUpdate?.(cloneSnapshot(this.snapshot));
  }

  private waitForActiveChange(): Promise<void> {
    if (this.active.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.activeWaiters.push(resolve));
  }
}
