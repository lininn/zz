import {
  crewRuntimeCommandSchema,
  crewRuntimeReplySchema,
  type CrewRuntimeCommand,
  type CrewRuntimeReply,
} from "@zcode/shared";
import type { ExternalRuntimeDispatchService } from "@zcode/core";
import type { ExternalRuntimeQueueRecord } from "@zcode/contracts";
import type { ExternalRuntimeDispatchInput } from "./external-runtime.js";

export interface CrewRuntimeFacadeOptions {
  service: ExternalRuntimeDispatchService;
  workspaceIdentity: string;
  workingDirectory: string;
  dispatch(input: ExternalRuntimeDispatchInput): Promise<unknown>;
  prepareStart?(): Promise<void>;
  readTask?(taskId: string): Promise<ExternalRuntimeQueueRecord | undefined>;
  canControl?(): boolean;
}

export function createCrewRuntimeHandler(
  options: CrewRuntimeFacadeOptions,
): (command: CrewRuntimeCommand) => Promise<CrewRuntimeReply> {
  const { service } = options;
  let admission = Promise.resolve();
  const readTask = options.readTask ?? ((taskId: string) => service.readTask(taskId));
  const read = async (taskId: string): Promise<CrewRuntimeReply> => {
    const entry = await readTask(taskId);
    if (
      !entry ||
      entry.request.workspace.identity !== options.workspaceIdentity ||
      entry.request.workspace.path !== options.workingDirectory
    ) {
      throw new Error("Unknown crew runtime task for workspace");
    }
    return crewRuntimeReplySchema.parse({
      kind: "task",
      task: {
        taskId,
        runtimeId: entry.request.runtimeId,
        runtimeState: entry.runtimeState,
        settled: entry.runtimeState !== "recovery_required" && entry.settled === true,
        ...(entry.summary ? { summary: entry.summary } : {}),
        ...(entry.pauseReason ? { reason: entry.pauseReason.slice(0, 2000) } : {}),
        ...(entry.nativeSessionId ? { nativeSessionId: entry.nativeSessionId } : {}),
        ...(entry.permission ? { permission: entry.permission } : {}),
      },
    });
  };
  const start = async (command: Extract<CrewRuntimeCommand, { action: "start" }>) => {
    await options.prepareStart?.();
    const prior = await readTask(command.taskId);
    if (prior) {
      if (
        prior.request.sessionId !== command.sessionId ||
        prior.request.runtimeId !== command.runtimeId ||
        prior.request.objective !== command.objective ||
        prior.request.accessMode !== command.accessMode
      ) {
        throw new Error("Crew runtime task identity collision");
      }
      return read(command.taskId);
    }
    const snapshot = await service.snapshot();
    if (snapshot.pauseReason) {
      if (
        snapshot.entries.some(
          (entry) =>
            entry.settled !== true ||
            entry.runtimeState === "recovery_required" ||
            entry.permission,
        )
      ) {
        throw new Error(`Crew runtime queue is fenced: ${snapshot.pauseReason}`);
      }
      // 用户重新派工是已停止任务后的显式继续，不重放旧 attempt 或越过未决权限。
      await service.resume();
    }
    await options.dispatch({
      taskId: command.taskId,
      runtimeId: command.runtimeId,
      ...(command.resumeTaskId ? { chatTaskId: command.resumeTaskId } : {}),
      // 群预算由服务端下发；子任务不自设超时。
      ...(command.timeoutMs ? { timeoutMs: command.timeoutMs } : {}),
      sessionId: command.sessionId,
      traceId: command.traceId,
      role: command.accessMode === "read" ? "reviewer" : "executor",
      accessMode: command.accessMode,
      objective: command.objective,
      executionMode: "sequential",
      networkProfile: "restricted",
      verificationCommands: [],
      skipVerification: false,
      allowDirtyWorkspace: false,
      useWorktree: false,
      unsafeTextFallback: false,
    });
    return read(command.taskId);
  };
  return async (input) => {
    const command = crewRuntimeCommandSchema.parse(input);
    switch (command.action) {
      case "probe": {
        const report = await service.probe(command.runtimeId, command.accessMode);
        return {
          kind: "probe",
          probe: {
            runtimeId: command.runtimeId,
            available: report.available,
            ...(report.version ? { version: report.version } : {}),
            ...(!report.available
              ? { reason: (report.warnings.join("; ") || "runtime unavailable").slice(0, 2000) }
              : {}),
          },
        };
      }
      case "start": {
        const result = admission.then(() => start(command));
        admission = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      }
      case "read":
        return read(command.taskId);
      case "cancel":
        await admission;
        if (options.canControl?.() === false) return read(command.taskId);
        await read(command.taskId);
        await service.cancel(command.taskId);
        return read(command.taskId);
      case "permission":
        if (options.canControl?.() === false) return read(command.taskId);
        await read(command.taskId);
        await service.respondPermission(command.taskId, command.requestId, command.approved);
        return read(command.taskId);
    }
  };
}
