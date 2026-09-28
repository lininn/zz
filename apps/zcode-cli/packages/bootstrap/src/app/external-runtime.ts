import { createCrewRuntimeHandler } from "./crew-runtime.js";
import type { CrewRuntimeCommand, CrewRuntimeReply } from "@zcode/shared";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  beginWorkspaceGuard,
  ClaudeCliAdapter,
  CodexCliAdapter,
  OpenCodeCliAdapter,
  createExternalRuntimeWorktree,
  createSystemProbeRunner,
  diffExternalRuntimeWorktree,
  ExternalRuntimeProcessHost,
  listExternalRuntimeWorktrees,
  removeExternalRuntimeWorktree,
  runExternalRuntimeVerification,
  type ExternalWorktreeDiff,
} from "@zcode/adapters/exec";
import { createSqliteExternalRuntimeQueueStore } from "@zcode/adapters/storage";
import {
  ExternalRuntimeDispatchService,
  type ExternalRuntimeServiceVerificationCommand,
} from "@zcode/core";
import type {
  ExternalRuntimeAccessMode,
  ExternalRuntimeNetworkProfile,
  ExternalRuntimeRole,
  ExternalRuntimeTaskRequest,
  ExternalRuntimePort,
  Logger,
} from "@zcode/contracts";

const FINAL_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: {
    summary: { type: "string", minLength: 1 },
    status: { enum: ["succeeded", "failed", "cancelled"] },
    artifacts: { type: "array", items: { type: "string" } },
  },
};

export interface ExternalRuntimeBootstrapOptions {
  dbPath: string;
  workingDirectory: string;
  workspaceIdentity: string;
  remoteSessionId?: string;
  cliStorageRoot: string;
  outerSandboxReady: boolean;
  /** 部署方进程 env；用于显式声明通道（outer sandbox / allow-dirty）。 */
  env?: NodeJS.ProcessEnv;
  /** Protocol observers must not recover or pump without an explicit leased start. */
  recoverOnCreate?: boolean;
  /** Trusted bootstrap/test adapter injection; not exposed to protocol callers. */
  adapters?: Map<string, ExternalRuntimePort>;
  logger?: Logger;
  now?: () => Date;
}

/**
 * 部署方通过环境变量显式声明 outer isolation 已验证（dev/自托管场景的接线通道）。
 * 与 options.externalRuntime.outerSandboxReady 同义：缺席即 fail-closed。
 * CLI 打包链路目前没有部署方传入 options，只能经 env 声明。
 */
export function resolveOuterSandboxReady(
  optionsSandboxReady: boolean | undefined,
  env: NodeJS.ProcessEnv | undefined,
): boolean {
  if (optionsSandboxReady === true) return true;
  const declared = (env ?? process.env).ZCODE_CREW_OUTER_SANDBOX_READY?.trim().toLowerCase();
  return declared === "1" || declared === "true";
}

/** write 派工是否允许脏工作区；默认 false，需 env 显式声明（保护未提交改动）。 */
export function resolveAllowDirtyWorkspace(env: NodeJS.ProcessEnv | undefined): boolean {
  const declared = (env ?? process.env).ZCODE_CREW_ALLOW_DIRTY_WORKSPACE?.trim().toLowerCase();
  return declared === "1" || declared === "true";
}

export interface ExternalRuntimeDispatchInput {
  taskId?: string;
  runtimeId?: string;
  role: ExternalRuntimeRole;
  accessMode: ExternalRuntimeAccessMode;
  executionMode: "sequential" | "parallel";
  chatTaskId?: string;
  objective: string;
  boundaries?: string[];
  verificationCommands: string[][];
  skipVerification: boolean;
  networkProfile: ExternalRuntimeNetworkProfile;
  allowDirtyWorkspace: boolean;
  useWorktree: boolean;
  unsafeTextFallback: boolean;
  sessionId: string;
  traceId: string;
}

export interface ExternalRuntimeTaskSummary {
  taskId: string;
  runtimeId: string;
  runtimeState: string;
  pauseReason?: string;
  worktreePath?: string;
  nativeSessionId?: string;
}

export interface ExternalRuntimeFacade {
  service: ExternalRuntimeDispatchService;
  crewRuntime(command: CrewRuntimeCommand): Promise<CrewRuntimeReply>;
  dispose(): void;
  shutdown(): Promise<void>;
  dispatchExternalRuntime(
    input: ExternalRuntimeDispatchInput,
  ): Promise<{ taskId: string; queuePosition: number }>;
  listExternalRuntimeTasks(): Promise<ExternalRuntimeTaskSummary[]>;
  cancelExternalRuntimeTask(input: { taskId: string }): Promise<{ cancelled: boolean }>;
  cleanupExternalRuntimeTask(input: { taskId: string }): Promise<{ cleaned: boolean; detail?: string }>;
  diffExternalRuntimeTask(input: { taskId: string }): Promise<ExternalWorktreeDiff>;
}

export async function createExternalRuntimeFacade(
  options: ExternalRuntimeBootstrapOptions,
): Promise<ExternalRuntimeFacade> {
  const db = new DatabaseSync(options.dbPath, { timeout: 5_000 });
  const now = options.now ?? (() => new Date());
  const processHost = new ExternalRuntimeProcessHost();
  const adapter = new ClaudeCliAdapter({
    processHost,
    outerSandboxReady: options.outerSandboxReady,
    preflightRunner: createSystemProbeRunner(),
    outputSchema: FINAL_OUTPUT_SCHEMA,
    testedVersion: "2.1.241",
    now,
  });
  const verificationArgv = new Map<string, string[]>();
  const store = createSqliteExternalRuntimeQueueStore(db, { workspaceIdentity: options.workspaceIdentity, workspacePath: options.workingDirectory, remoteSessionId: options.remoteSessionId });
  const service = new ExternalRuntimeDispatchService({
    adapters: options.adapters ?? new Map<string, ExternalRuntimePort>([
      [adapter.id, adapter],
      ["codex-cli", new CodexCliAdapter({ processHost, outerSandboxReady: options.outerSandboxReady, preflightRunner: createSystemProbeRunner(), now })],
      ["opencode-cli", new OpenCodeCliAdapter({ processHost, outerSandboxReady: options.outerSandboxReady, preflightRunner: createSystemProbeRunner(), now })],
    ]),
    store,
    outerSandboxReady: options.outerSandboxReady,
    // 脏工作区 write 派工默认拒绝（保护未提交改动）；部署方可经 env 显式放开。
    allowDirtyWorkspace: resolveAllowDirtyWorkspace(options.env),
    beginWorkspaceGuard: async (request) => beginWorkspaceGuard(request.workspace.path),
    resolveVerificationCommands: (commandIds): ExternalRuntimeServiceVerificationCommand[] =>
      commandIds.map((id) => {
        const argv = verificationArgv.get(id);
        if (!argv) throw new Error(`Unknown verification command id: ${id}`);
        return { id, argv };
      }),
    runVerification: async (commands, runOptions) => {
      const evidence = await runExternalRuntimeVerification(commands, {
        cwd: runOptions.cwd,
        timeoutMs: runOptions.timeoutMs,
      });
      return { status: evidence.status };
    },
    now,
  });
  let activated = options.recoverOnCreate !== false;
  if (activated) await service.recover();
  const prepareStart = async () => {
    if (activated) return;
    // 只有 Host 已持租约的显式 start 才能恢复；旧 queued 不属于这次新任务的租约。
    await service.recover({ replayQueued: false });
    activated = true;
  };
  const prepareCrewStart = async () => {
    // activated 只说明曾经运行过，不代表仍持有此 scope 的最新快照。
    if (await service.refreshFromStoreIfIdle()) {
      await service.recover({ replayQueued: false });
      activated = true;
    } else await prepareStart();
  };
  options.logger?.info("External runtime dispatch service ready", {
    event: "external_runtime.service.ready",
    module: "bootstrap.app",
  });

  const worktreeParentDir = async () => {
    const parentDir = join(options.cliStorageRoot, "external-worktrees");
    await mkdir(parentDir, { recursive: true });
    return parentDir;
  };
  const worktreePathFor = (taskId: string) => join(options.cliStorageRoot, "external-worktrees", taskId);

  const facade: ExternalRuntimeFacade = {
    service,
    crewRuntime: createCrewRuntimeHandler({
      service, ...options, prepareStart: prepareCrewStart, canControl: () => activated,
      readTask: async (taskId) => {
        const local = activated ? await service.readTask(taskId) : undefined;
        // 本地已准入 queued 尚未进入监督循环，也不能被误报为失联。
        if (local && (service.isTaskActive(taskId) || local.runtimeState === "queued")) return local;
        // 空闲实例也可能刚交出过租约；resume 候选必须读新结果，不缓存他人队列。
        const snapshot = await store.load();
        const entry = snapshot?.entries.filter((item) => item.request.taskId === taskId).at(-1);
        if (entry && entry.settled !== true) {
          entry.runtimeState = "recovery_required";
          entry.settled = false;
          entry.pauseReason = "process supervision belongs to another Host or requires recovery";
          delete entry.permission;
        } else if (entry?.runtimeState === "awaiting_permission" && local?.permission &&
          local.runtimeState === entry.runtimeState && local.request.attemptId === entry.request.attemptId &&
          local.updatedAt === entry.updatedAt) {
          // vendor 已退出后的本地权限仍需展示；只补同一持久化 attempt 的权限，不覆盖其状态。
          entry.permission = { ...local.permission, canRespond: false };
        }
        return entry;
      },
      dispatch: (input) => facade.dispatchExternalRuntime(input),
    }),
    dispose: () => db.close(),
    shutdown: async () => {
      if (!activated) { db.close(); return; }
      const snapshot = await service.snapshot();
      await Promise.all(snapshot.entries.filter((entry) => entry.settled !== true).map((entry) => service.cancel(entry.request.taskId)));
      await service.waitForIdle();
      db.close();
    },
    dispatchExternalRuntime: async (input: ExternalRuntimeDispatchInput) => {
      await prepareStart();
      let taskId = input.taskId ?? `ext_${randomUUID()}`;
      const attemptId = `attempt_${randomUUID()}`;
      let resumeNativeSessionId: string | undefined;
      if (input.chatTaskId) {
        const snapshot = await service.snapshot();
        const prior = snapshot.entries.filter((entry) => entry.request.taskId === input.chatTaskId).at(-1);
        if (!prior?.nativeSessionId || prior.runtimeState !== "succeeded" ||
          prior.request.sessionId !== input.sessionId || prior.request.runtimeId !== (input.runtimeId ?? adapter.id) ||
          prior.request.workspace.identity !== options.workspaceIdentity || prior.request.workspace.path !== options.workingDirectory ||
          (await service.readTask(prior.request.taskId))?.settled !== true) {
          throw new Error(`No completed attempt with a native session to continue for task ${input.chatTaskId}`);
        }
        if (!input.taskId) taskId = input.chatTaskId;
        resumeNativeSessionId = prior.nativeSessionId;
      }
      const commandIds = input.verificationCommands.map((argv, index) => {
        const id = `verify-${taskId}-${index}`;
        verificationArgv.set(id, [...argv]);
        return id;
      });
      let workspacePath = options.workingDirectory;
      let workspaceIsolated = false;
      if (input.useWorktree || (input.executionMode === "parallel" && input.accessMode === "read")) {
        const parentDir = await worktreeParentDir();
        const worktree = await createExternalRuntimeWorktree(options.workingDirectory, parentDir, taskId);
        await writeFile(
          join(parentDir, `${taskId}.json`),
          JSON.stringify({ baseCommit: worktree.baseCommit, createdAt: now().toISOString() }),
        );
        workspacePath = worktree.path;
        workspaceIsolated = true;
      }
      const request: ExternalRuntimeTaskRequest = {
        schemaVersion: 1,
        taskId,
        attemptId,
        sessionId: input.sessionId,
        traceId: input.traceId,
        runtimeId: input.runtimeId ?? adapter.id,
        role: input.role,
        accessMode: input.accessMode,
        networkProfile: input.networkProfile,
        objective: input.objective,
        boundaries: input.boundaries ?? ["do not escape workspace"],
        workspace: {
          identity: options.workspaceIdentity,
          path: workspacePath,
          kind: "git",
          ...(workspaceIsolated ? { isolated: true } : {}),
        },
        baseline: { kind: "git", ref: "HEAD" },
        instructionSnapshotRef: taskId,
        timeoutMs: 600_000,
        budget: { wallTimeMs: 600_000, maxOutputBytes: 1_048_576 },
        verification: { commandIds, ...(input.skipVerification ? { skip: true } : {}) },
        retention: { structuredDays: 30, rawDays: 7 },
        sessionMode: "one-shot",
        executionMode: input.executionMode,
        ...(resumeNativeSessionId ? { resumeNativeSessionId } : {}),
        failoverPolicy: "none",
      };
      return service.dispatch(request);
    },
    listExternalRuntimeTasks: async () => {
      const snapshot = await service.snapshot();
      const worktrees = await listExternalRuntimeWorktrees(options.workingDirectory).catch(() => []);
      return snapshot.entries.map((entry) => {
        const worktreePath = worktrees.find((path) => path.endsWith(`/${entry.request.taskId}`));
        return {
          taskId: entry.request.taskId,
          runtimeId: entry.request.runtimeId,
          runtimeState: entry.runtimeState,
          ...(entry.pauseReason ? { pauseReason: entry.pauseReason } : {}),
          ...(worktreePath ? { worktreePath } : {}),
          ...(entry.nativeSessionId ? { nativeSessionId: entry.nativeSessionId } : {}),
        };
      });
    },
    cancelExternalRuntimeTask: async (input: { taskId: string }) => {
      await service.cancel(input.taskId);
      const snapshot = await service.snapshot();
      const entry = snapshot.entries.find((item) => item.request.taskId === input.taskId);
      return { cancelled: entry?.runtimeState === "cancelled" };
    },
    cleanupExternalRuntimeTask: async (input: { taskId: string }): Promise<{ cleaned: boolean; detail?: string }> => {
      const snapshot = await service.snapshot();
      const entries = snapshot.entries.filter((item) => item.request.taskId === input.taskId);
      if (entries.length === 0) return { cleaned: false, detail: `Unknown task: ${input.taskId}` };
      if (entries.some((entry) => !["succeeded", "failed", "cancelled"].includes(entry.runtimeState))) {
        return { cleaned: false, detail: `Task ${input.taskId} is still active; cancel it first` };
      }
      try {
        await removeExternalRuntimeWorktree(options.workingDirectory, worktreePathFor(input.taskId));
      } catch (error) {
        return { cleaned: false, detail: error instanceof Error ? error.message : String(error) };
      }
      return { cleaned: true };
    },
    diffExternalRuntimeTask: async (input: { taskId: string }): Promise<ExternalWorktreeDiff> => {
      const snapshot = await service.snapshot();
      const entries = snapshot.entries.filter((item) => item.request.taskId === input.taskId);
      if (entries.length === 0) throw new Error(`Unknown task: ${input.taskId}`);
      const worktrees = await listExternalRuntimeWorktrees(options.workingDirectory);
      const path = worktrees.find((candidate) => candidate.endsWith(`/${input.taskId}`));
      if (!path) throw new Error(`No worktree recorded for task ${input.taskId}`);
      let metadata: { baseCommit?: string };
      try {
        metadata = JSON.parse(
          await readFile(join(options.cliStorageRoot, "external-worktrees", `${input.taskId}.json`), "utf8"),
        ) as { baseCommit?: string };
      } catch {
        throw new Error(`No worktree metadata recorded for task ${input.taskId}`);
      }
      if (!metadata.baseCommit) throw new Error(`No base commit recorded for task ${input.taskId}`);
      return diffExternalRuntimeWorktree(path, metadata.baseCommit);
    },
  };
  return facade;
}
