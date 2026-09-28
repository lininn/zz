import {
  ExternalRuntimeTaskRequestSchema,
  ExternalRuntimeResultSchema,
  type ExternalRuntimeCapabilityReport,
  isTerminalExternalRuntimeState,
  mapExternalRuntimeStateToSubagentStatus,
  validateExternalRuntimeEventSequence,
  type ExternalRuntimeEventEnvelope,
  type ExternalRuntimePort,
  type ExternalRuntimeQueueSnapshot,
  type ExternalRuntimeTaskRequest,
} from "@zcode/contracts";
import {
  ExternalRuntimeCoordinator,
  type ExternalRuntimeDispatchResult,
  type ExternalRuntimeQueueStore,
} from "./external-runtime-coordinator.js";
import { crewRuntimePermission, validateCrewRuntimeEvent } from "./crew-runtime-events.js";
import type { RuntimeTaskRegistry, RuntimeTaskSnapshot } from "./registry.js";

export interface ExternalRuntimeServiceVerificationCommand {
  id: string;
  argv: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface ExternalRuntimeServiceVerificationOutcome {
  status: "passed" | "failed";
}

export interface ExternalRuntimeWorkspaceGuard {
  isClean(): Promise<boolean>;
  detectChanges(): Promise<{ changed: boolean; conflict: boolean; undetectable?: boolean }>;
}

export interface ExternalRuntimeDispatchServiceOptions {
  adapters: Map<string, ExternalRuntimePort>;
  store: ExternalRuntimeQueueStore;
  outerSandboxReady: boolean;
  allowDirtyWorkspace: boolean;
  beginWorkspaceGuard: (request: ExternalRuntimeTaskRequest) => Promise<ExternalRuntimeWorkspaceGuard>;
  resolveVerificationCommands: (
    commandIds: readonly string[],
  ) => ExternalRuntimeServiceVerificationCommand[];
  runVerification: (
    commands: readonly ExternalRuntimeServiceVerificationCommand[],
    options: { cwd: string; timeoutMs: number },
  ) => Promise<ExternalRuntimeServiceVerificationOutcome>;
  taskRegistry?: RuntimeTaskRegistry;
  now?: () => Date;
}

export interface ExternalRuntimeDispatchOutcome {
  taskId: string;
  queuePosition: number;
}

const TERMINAL_QUEUE_STATES = new Set(["succeeded", "failed", "cancelled"]);

export function describeExternalRuntimeQueueEntry(
  snapshot: ExternalRuntimeQueueSnapshot,
  taskId: string,
): string {
  const entry = snapshot.entries.find((item) => item.request.taskId === taskId);
  if (!entry) return `External runtime task ${taskId} not found.`;
  const parts = [
    `External runtime task ${entry.request.taskId}`,
    `runtime ${entry.request.runtimeId}`,
    `state ${entry.runtimeState}`,
  ];
  if (entry.pauseReason) parts.push(`reason: ${entry.pauseReason}`);
  return `${parts.join(" | ")}.`;
}

export class ExternalRuntimeDispatchService {
  private readonly coordinator: ExternalRuntimeCoordinator;

  constructor(private readonly options: ExternalRuntimeDispatchServiceOptions) {
    this.coordinator = new ExternalRuntimeCoordinator({
      store: options.store,
      execute: (entry, signal) => this.execute(entry.request, signal),
      ...(options.now ? { now: options.now } : {}),
      ...(options.taskRegistry
        ? {
            onUpdate: (snapshot) => {
              for (const entry of snapshot.entries) {
                options.taskRegistry?.register(this.projectSnapshot(entry));
              }
            },
          }
        : {}),
    });
  }

  private projectSnapshot(entry: ExternalRuntimeQueueSnapshot["entries"][number]): RuntimeTaskSnapshot {
    const terminal = isTerminalExternalRuntimeState(entry.runtimeState);
    return {
      taskId: entry.request.taskId,
      agentId: `external-runtime:${entry.request.runtimeId}`,
      agentType: entry.request.runtimeId,
      description: entry.request.objective,
      status: mapExternalRuntimeStateToSubagentStatus(entry.runtimeState),
      startedAt: new Date(entry.enqueuedAt),
      ...(terminal ? { completedAt: new Date(entry.updatedAt) } : {}),
      ...(entry.pauseReason ? { error: entry.pauseReason } : {}),
      type: "external_runtime",
      prompt: entry.request.objective,
      ...(entry.summary ? { resultText: entry.summary } : {}),
    };
  }

  async dispatch(requestInput: ExternalRuntimeTaskRequest): Promise<ExternalRuntimeDispatchOutcome> {
    const request = ExternalRuntimeTaskRequestSchema.parse(requestInput);
    if (
      (request.executionMode ?? "sequential") === "parallel" &&
      request.accessMode === "write" &&
      request.workspace.isolated !== true
    ) {
      throw new Error("delegate: parallel write tasks require an isolated workspace (--worktree)");
    }
    const record = await this.coordinator.enqueue(request);
    const snapshot = await this.coordinator.load();
    const pending = snapshot.entries.filter((entry) => !TERMINAL_QUEUE_STATES.has(entry.runtimeState));
    const queuePosition = pending.findIndex((entry) => entry.request.taskId === record.request.taskId) + 1;
    return { taskId: record.request.taskId, queuePosition };
  }

  async probe(runtimeId: string, accessMode: "read" | "write"): Promise<ExternalRuntimeCapabilityReport> {
    const unavailable = (reason: string): ExternalRuntimeCapabilityReport => ({
      schemaVersion: 1, runtimeId, available: false, authenticated: false, testedVersion: false,
      capabilities: {}, requiredCapabilities: [], warnings: [reason], probedAt: (this.options.now?.() ?? new Date()).toISOString(),
    });
    if (!this.options.outerSandboxReady) return unavailable("outer_isolation_missing");
    const adapter = this.options.adapters.get(runtimeId);
    if (!adapter) return unavailable(`runtime not registered: ${runtimeId}`);
    try {
      const requiredCapabilities = accessMode === "write"
        ? ["structuredOutput", "structuredTerminalResult", "permissionMode"] : ["structuredOutput"];
      const report = await adapter.probe({ runtimeId, requiredCapabilities });
      const missing = requiredCapabilities.filter((name) => report.capabilities[name] !== true);
      if (report.runtimeId !== runtimeId || !report.authenticated || missing.length) {
        return { ...report, runtimeId, available: false, warnings: [...report.warnings, !report.authenticated ? "authentication_failed" : `required_capability_missing:${missing.join(",") || "runtimeId"}`] };
      }
      return report;
    } catch (error) { return unavailable(error instanceof Error ? error.message : String(error)); }
  }

  isTaskActive(taskId: string): boolean { return this.coordinator.isActive(taskId); }

  async readTask(taskId: string): Promise<ExternalRuntimeQueueSnapshot["entries"][number] | undefined> {
    const snapshot = await this.snapshot();
    const entry = snapshot.entries.filter((item) => item.request.taskId === taskId).at(-1);
    if (entry && this.coordinator.isActive(taskId)) entry.settled = false;
    else if (entry?.permission) entry.permission.canRespond = false;
    return entry;
  }

  async respondPermission(taskId: string, requestId: string, approved: boolean): Promise<void> {
    const entry = await this.readTask(taskId);
    if (!entry?.permission || entry.permission.requestId !== requestId || entry.runtimeState !== "awaiting_permission") {
      throw new Error("stale or unknown runtime permission request");
    }
    const adapter = this.options.adapters.get(entry.request.runtimeId);
    if (!approved || !entry.permission.canRespond || !adapter?.respondPermission) {
      await this.coordinator.cancel(taskId, approved ? "permission_reply_unsupported" : "permission denied");
      return;
    }
    if (!this.coordinator.isActive(taskId)) throw new Error("permission process is no longer active");
    try {
      await adapter.respondPermission(entry.request, { requestId, approved });
      await this.coordinator.updatePermission(taskId, entry.request.attemptId, undefined);
    } catch (error) {
      await this.cancel(taskId);
      throw error;
    }
  }

  async cancel(taskId: string): Promise<void> {
    await this.coordinator.cancel(taskId);
  }

  async resume(): Promise<void> {
    await this.coordinator.resume();
  }

  async refreshFromStoreIfIdle(): Promise<boolean> {
    return this.coordinator.refreshFromStoreIfIdle();
  }

  async recover(options: { replayQueued?: boolean } = {}): Promise<void> {
    await this.coordinator.recover(options);
  }

  async waitForIdle(): Promise<void> {
    await this.coordinator.waitForIdle();
  }

  async snapshot(): Promise<ExternalRuntimeQueueSnapshot> {
    return this.coordinator.load();
  }

  private async execute(
    requestInput: ExternalRuntimeTaskRequest,
    signal: AbortSignal,
  ): Promise<ExternalRuntimeDispatchResult> {
    const request = ExternalRuntimeTaskRequestSchema.parse(requestInput);
    const adapter = this.options.adapters.get(request.runtimeId);
    if (!adapter) {
      return {
        runtimeState: "runtime_unavailable",
        structuredResult: false,
        pauseReason: `runtime not registered: ${request.runtimeId}`,
      };
    }
    if (signal.aborted) {
      return { runtimeState: "cancelled", structuredResult: false, pauseReason: "cancelled by user" };
    }
    const capability = await this.probe(request.runtimeId, request.accessMode);
    if (!capability.available) {
      return {
        runtimeState: "runtime_unavailable",
        structuredResult: false,
        pauseReason: capability.warnings.join("; ") || "runtime unavailable",
      };
    }
    const guard = await this.options.beginWorkspaceGuard(request);
    if (request.accessMode === "write" && !this.options.allowDirtyWorkspace) {
      if (!(await guard.isClean())) {
        return {
          runtimeState: "workspace_unsupported",
          structuredResult: false,
          pauseReason: "dirty workspace requires explicit allow-dirty or worktree isolation",
        };
      }
    }
    if (signal.aborted) return { runtimeState: "cancelled", structuredResult: false };
    const events: ExternalRuntimeEventEnvelope[] = [];
    let pendingPermission: string | undefined;
    let cancellation: Promise<void> | undefined;
    const handle = { taskId: request.taskId, attemptId: request.attemptId, runtimeId: request.runtimeId };
    const onAbort = () => {
      cancellation = adapter.cancel(handle);
      void cancellation.catch(() => {});
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      for await (const input of adapter.start(request)) {
        const event = validateCrewRuntimeEvent(input, request, events.length + 1);
        events.push(event);
        // start 内部可能异步准备文件/进程，首次 cancel 早于 handle 注册；启动事件后补发取消。
        if (signal.aborted) await adapter.cancel(handle);
        if (event.type === "permission.requested") {
          const permission = crewRuntimePermission(event, typeof adapter.respondPermission === "function");
          pendingPermission = permission.requestId;
          await this.coordinator.updatePermission(request.taskId, request.attemptId, permission);
        } else if (event.type === "permission.resolved") {
          const resolved = crewRuntimePermission(event, false);
          if (resolved.requestId === pendingPermission) {
            pendingPermission = undefined;
            await this.coordinator.updatePermission(request.taskId, request.attemptId, undefined);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("recovery_required")) {
        return { runtimeState: "recovery_required", settled: false, structuredResult: false, pauseReason: message };
      }
      if (message.startsWith("policy_violation")) {
        return { runtimeState: "policy_violation", structuredResult: false, pauseReason: message };
      }
      if (message.startsWith("protocol_error")) {
        return { runtimeState: "protocol_error", structuredResult: false, pauseReason: message };
      }
      return { runtimeState: "failed", structuredResult: false, pauseReason: message };
    } finally {
      signal.removeEventListener("abort", onAbort);
      await cancellation;
    }
    try {
      validateExternalRuntimeEventSequence(events);
    } catch (error) {
      return {
        runtimeState: "protocol_error",
        structuredResult: false,
        pauseReason: error instanceof Error ? error.message : String(error),
      };
    }
    const terminalEvent = events.at(-1)!;
    const result = ExternalRuntimeResultSchema.parse(terminalEvent.payload);
    if (result.taskId !== request.taskId || result.attemptId !== request.attemptId || result.runtimeId !== request.runtimeId) {
      return { runtimeState: "protocol_error", structuredResult: false, pauseReason: "terminal result belongs to another attempt" };
    }
    const terminalSessionId = result.nativeSessionId ?? terminalEvent.nativeSessionId;
    const settle = (outcome: Omit<ExternalRuntimeDispatchResult, "nativeSessionId">): ExternalRuntimeDispatchResult => ({
      ...outcome, summary: result.summary, ...(terminalSessionId ? { nativeSessionId: terminalSessionId } : {}),
    });
    // vendor 的失败/取消终态不能因结构化输出合法就提升为成功。
    if (result.status === "cancelled") return settle({ runtimeState: result.status, structuredResult: true });
    const current = await this.readTask(request.taskId);
    if (pendingPermission && current?.permission) {
      return settle({ runtimeState: "awaiting_permission", structuredResult: true, pauseReason: "external runtime requested permission" });
    }
    if (result.status === "failed") return settle({ runtimeState: "failed", structuredResult: true });
    let workspaceChanged = false;
    if (request.accessMode === "write") {
      const changes = await guard.detectChanges();
      // allow-dirty 放行时保护性 conflict 一并豁免（含非 git 工作区：baseline 捕获
      // 失败时 detectChanges 恒返回 conflict，会把执行结果无条件打回）。部署方已
      // 显式声明接受工作区风险；changed 仍如实上报供变更摘要与验证使用。
      if (changes.conflict && !this.options.allowDirtyWorkspace) {
        return settle({
          runtimeState: "apply_conflict",
          structuredResult: true,
          workspaceChanged: true,
          pauseReason: "worker modified or removed pre-existing workspace content",
        });
      }
      // 非 git 工作区无从检测变更：按"可能有改动"处理，不得让 no-change 门误杀。
      workspaceChanged = changes.undetectable ? true : changes.changed;
    }
    let verification: ExternalRuntimeDispatchResult["verification"];
    if (request.accessMode === "read") {
      verification = undefined;
    } else if (request.verification.skip) {
      verification = "skipped";
    } else if (request.verification.commandIds.length === 0) {
      // 未配置验证命令 = 明确选择无独立验证收口（crew 的验收由 PM review 承担），
      // 与显式 skip 同语义；"missing" 保留给配了命令却解析失败的场景。
      verification = "skipped";
    } else {
      const outcome = await this.options.runVerification(
        this.options.resolveVerificationCommands(request.verification.commandIds),
        { cwd: request.workspace.path, timeoutMs: request.timeoutMs },
      );
      verification = outcome.status === "passed" ? "passed" : "failed";
    }
    return settle({ runtimeState: "succeeded", structuredResult: true, workspaceChanged, verification });
  }
}
