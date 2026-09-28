import { parseDelegateArguments } from "@zcode/core";
import type { TuiSubmitPromptResult } from "@zcode/tui";
import type { CommandCenterApp, CommandCenterDeps } from "../types.js";
import { splitArgs } from "../utils.js";

const DELEGATE_USAGE =
  "Usage: /delegate [--runtime <id>] [--role <role>] [--read-only|--write] " +
  '[--verify "<cmd>"] [--skip-verification] [--network allowed|restricted|disabled] ' +
  "[--allow-dirty] [--worktree] [--unsafe-text-fallback] <objective>";

type DelegateApp = CommandCenterApp;

export async function handleDelegateCommand(
  args: string,
  deps: CommandCenterDeps,
  fixedRuntimeId?: string,
): Promise<TuiSubmitPromptResult> {
  const [action, actionArg] = splitArgs(args);
  if (action === "list") return handleList(deps);
  if (action === "cancel") return handleCancel(actionArg, deps);
  if (action === "cleanup") return handleCleanup(actionArg, deps);
  if (action === "diff") return handleDiff(actionArg, deps);

  let parsed;
  try {
    parsed = parseDelegateArguments(args, fixedRuntimeId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return respond(deps, `${reason}\n\n${DELEGATE_USAGE}`);
  }
  const app = await deps.getApp();
  if (!app.dispatchExternalRuntime) {
    return respond(deps, "External runtime dispatch is not available in this client.");
  }
  const result = await app.dispatchExternalRuntime({
    ...parsed,
    sessionId: app.sessionId,
    traceId: app.traceId,
  });
  return respond(
    deps,
    `Delegated task ${result.taskId} queued in background (position ${result.queuePosition}).`,
  );
}

async function handleList(deps: CommandCenterDeps): Promise<TuiSubmitPromptResult> {
  const app = await deps.getApp();
  if (!app.listExternalRuntimeTasks) {
    return respond(deps, "External runtime dispatch is not available in this client.");
  }
  const tasks = await app.listExternalRuntimeTasks();
  if (tasks.length === 0) return respond(deps, "No external runtime tasks.");
  return respond(
    deps,
    [
      `External runtime tasks (${tasks.length}):`,
      ...tasks.map((task) =>
        task.pauseReason
          ? `- ${task.taskId} · ${task.runtimeId} · ${task.runtimeState} (${task.pauseReason})`
          : `- ${task.taskId} · ${task.runtimeId} · ${task.runtimeState}`,
      ),
    ].join("\n"),
  );
}

async function handleCancel(
  taskId: string | undefined,
  deps: CommandCenterDeps,
): Promise<TuiSubmitPromptResult> {
  if (!taskId) return respond(deps, `Usage: /delegate cancel <taskId>`);
  const app: DelegateApp = await deps.getApp();
  if (!app.cancelExternalRuntimeTask) {
    return respond(deps, "External runtime dispatch is not available in this client.");
  }
  const result = await app.cancelExternalRuntimeTask({ taskId });
  return respond(
    deps,
    result.cancelled ? `Cancelled external runtime task ${taskId}.` : `Task ${taskId} is not cancellable.`,
  );
}

async function handleCleanup(
  taskId: string | undefined,
  deps: CommandCenterDeps,
): Promise<TuiSubmitPromptResult> {
  if (!taskId) return respond(deps, `Usage: /delegate cleanup <taskId>`);
  const app = await deps.getApp();
  if (!app.cleanupExternalRuntimeTask) {
    return respond(deps, "External runtime dispatch is not available in this client.");
  }
  const result = await app.cleanupExternalRuntimeTask({ taskId });
  return respond(
    deps,
    result.cleaned
      ? `Cleaned up worktree for external runtime task ${taskId}.`
      : `Could not clean up ${taskId}${result.detail ? `: ${result.detail}` : "."}`,
  );
}

async function handleDiff(
  taskId: string | undefined,
  deps: CommandCenterDeps,
): Promise<TuiSubmitPromptResult> {
  if (!taskId) return respond(deps, `Usage: /delegate diff <taskId>`);
  const app = await deps.getApp();
  if (!app.diffExternalRuntimeTask) {
    return respond(deps, "External runtime dispatch is not available in this client.");
  }
  const result = await app.diffExternalRuntimeTask({ taskId });
  const lines = [`Diff for external runtime task ${taskId}:`, "", result.diff];
  if (result.untracked.length > 0) {
    lines.push("", `Untracked files (${result.untracked.length}):`, ...result.untracked.map((path) => `- ${path}`));
  }
  if (result.truncated) lines.push("", "[diff truncated]");
  return respond(deps, lines.join("\n"));
}

function respond(deps: CommandCenterDeps, response: string): TuiSubmitPromptResult {
  return {
    mode: deps.getMode?.(),
    response,
  };
}
