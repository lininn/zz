export { resolveEffectiveBashShellSelection } from "./bash-shell-provider.js";
export {
  applyResolvedShellCommandForTest,
  buildExecutionEnv,
  resolveExecutionCommand,
  setResolvedShellLoginMode,
} from "./execution-command.js";
export type { ResolvedSpawnCommand } from "./execution-command.js";
export type { NodeExecutionAdapterOptions } from "./execution-adapter-types.js";
export { createNodeExecutionAdapter, NodeExecutionAdapter } from "./node-execution-adapter.js";
export { decodeExecutionOutputBuffer } from "./outputEncoding.js";
export {
  ClaudeCliAdapter,
  CLAUDE_RUNTIME_ID,
  type ClaudeCliAdapterOptions,
} from "./external-runtime/claude-adapter.js";
export {
  ExternalRuntimeProcessHost,
  buildExternalRuntimeEnvironment,
  assertExternalRuntimeCommand,
  isExternalRuntimePolicyViolationEvent,
  type ExternalRuntimeProcessStartOptions,
} from "./external-runtime/process-host.js";
export {
  ExternalRuntimeRegistry,
  runExternalRuntimePreflight,
  toCapabilityReport,
  type ProbeCommandRunner,
} from "./external-runtime/preflight.js";
export { createSystemProbeRunner } from "./external-runtime/probe-runner.js";
export {
  runExternalRuntimeVerification,
  type ExternalRuntimeVerificationCommand,
} from "./external-runtime/verification-runner.js";
export {
  beginWorkspaceGuard,
  captureGitWorkspaceBaseline,
  compareWorkspaceToBaseline,
} from "./external-runtime/git-baseline.js";
export {
  createExternalRuntimeWorktree,
  removeExternalRuntimeWorktree,
  listExternalRuntimeWorktrees,
  diffExternalRuntimeWorktree,
  type ExternalWorktree,
  type ExternalWorktreeDiff,
} from "./external-runtime/worktree.js";
export {
  CodexCliAdapter,
  CODEX_RUNTIME_ID,
  type CodexCliAdapterOptions,
} from "./external-runtime/codex-adapter.js";
export {
  OpenCodeCliAdapter,
  OPENCODE_RUNTIME_ID,
  type OpenCodeCliAdapterOptions,
} from "./external-runtime/opencode-adapter.js";
