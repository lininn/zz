import {
  ExternalRuntimeResultSchema,
  type ExternalRuntimeCapabilityReport,
  type ExternalRuntimeEventEnvelope,
  type ExternalRuntimePort,
  type ExternalRuntimeResult,
  type ExternalRuntimeTaskRequest,
} from "@zcode/contracts";
import {
  CLAUDE_ENV_ALLOWLIST,
  CLAUDE_FORBIDDEN_TOOLS,
  ClaudeFinalOutputSchema,
  ClaudeNativeEventSchema,
  buildClaudePrompt,
  claudeModelArgs,
  isClaudeLeafEvent,
  translateClaudeEvent,
  validateClaudeConfiguredArgs,
  type ClaudeNativeEvent,
} from "./claude-events.js";
import type {
  ExternalRuntimeProcessHandle,
  ExternalRuntimeProcessHost,
} from "./process-host.js";
import {
  ExternalRuntimeRegistry,
  runExternalRuntimePreflight,
  toCapabilityReport,
  type ProbeCommandRunner,
} from "./preflight.js";

export const CLAUDE_RUNTIME_ID = "claude-cli";

export interface ClaudeCliAdapterOptions {
  processHost?: Pick<ExternalRuntimeProcessHost, "start">;
  binaryPath?: string;
  outerSandboxReady: boolean;
  defaultModel?: string;
  outputSchema?: Record<string, unknown>;
  configuredArgs?: readonly string[];
  minimumVersion?: string;
  testedVersion?: string;
  testedRange?: string;
  preflightRunner?: ProbeCommandRunner;
  now?: () => Date;
  eventId?: (sequence: number) => string;
}

type EnvelopeFn = (type: string, payload: unknown, sessionId?: string) => ExternalRuntimeEventEnvelope;

const HELP_ARGS = ["--help"] as const;
const STDERR_TAIL_CHARS = 2000;

function capabilityProbe(
  capability: "structuredOutput" | "structuredTerminalResult" | "permissionMode",
  includesAny: readonly (readonly string[])[],
) {
  return { args: HELP_ARGS, capability, includesAny };
}

async function stopClaudeProcess(handle: ExternalRuntimeProcessHandle): Promise<void> {
  try { await handle.cancel(); await handle.completed; }
  catch { throw new Error("recovery_required: Claude process stop could not be proven"); }
}

/** vendor stderr 可能含密钥/带凭据的 URL；只保留有界尾部，脱敏后再进入错误消息。 */
function redactExternalStderr(value: string): string {
  return value
    .replace(/\b(?:sk|ghp|gho|xox[baprs])-[\w-]{8,}\b/gi, "[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|token|secret|password)\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/\/\/[^@/\s]+@/g, "//[REDACTED]@")
    .slice(-STDERR_TAIL_CHARS);
}

export class ClaudeCliAdapter implements ExternalRuntimePort {
  readonly id = CLAUDE_RUNTIME_ID;
  private readonly processHost: Pick<ExternalRuntimeProcessHost, "start">;
  private readonly binaryPath: string;
  private readonly outerSandboxReady: boolean;
  private readonly defaultModel?: string;
  private readonly outputSchema?: Record<string, unknown>;
  private readonly configuredArgs?: readonly string[];
  private readonly minimumVersion?: string;
  private readonly testedVersion?: string;
  private readonly testedRange?: string;
  private readonly preflightRunner?: ProbeCommandRunner;
  private readonly now: () => Date;
  private readonly eventId: (sequence: number) => string;
  private readonly handles = new Map<string, ExternalRuntimeProcessHandle>();

  constructor(options: ClaudeCliAdapterOptions) {
    if (!options.processHost) throw new Error("Claude adapter requires a process host");
    this.processHost = options.processHost;
    this.binaryPath = options.binaryPath ?? "claude";
    this.outerSandboxReady = options.outerSandboxReady;
    this.defaultModel = options.defaultModel;
    this.outputSchema = options.outputSchema;
    this.configuredArgs = options.configuredArgs;
    this.minimumVersion = options.minimumVersion;
    this.testedVersion = options.testedVersion;
    this.testedRange = options.testedRange;
    this.preflightRunner = options.preflightRunner;
    this.now = options.now ?? (() => new Date());
    this.eventId = options.eventId ?? ((sequence) => `claude-event-${sequence}`);
  }

  async probe(context: { runtimeId: string; requiredCapabilities: string[] }): Promise<ExternalRuntimeCapabilityReport> {
    if (!this.preflightRunner) throw new Error("Claude adapter requires a preflight runner");
    const registry = new ExternalRuntimeRegistry([this.definition()]);
    const report = await runExternalRuntimePreflight({
      runtimeId: this.id,
      access: "read",
      binary: this.binaryPath,
      runner: this.preflightRunner,
      outerIsolation: this.outerSandboxReady,
      leafEnforcement: { toolAndFeatureDeny: true, commandDeny: true, eventMonitoring: true, resourceLimits: true },
      registry,
    });
    return toCapabilityReport(report, {
      runtimeId: this.id,
      requiredCapabilities: context.requiredCapabilities,
      now: this.now,
    });
  }

  async *start(request: ExternalRuntimeTaskRequest): AsyncIterable<ExternalRuntimeEventEnvelope> {
    if (request.runtimeId !== this.id) throw new Error(`Claude adapter cannot run ${request.runtimeId}`);
    if (!this.outerSandboxReady) {
      throw new Error("Cannot start Claude before the outer sandbox is ready");
    }
    const handle = await this.processHost.start({
      command: {
        executable: this.binaryPath,
        args: [
          "--print",
          "--verbose",
          "--output-format",
          "stream-json",
          // preflight 验证的 leaf/权限边界必须真正用于启动，不能只探测而不执行。
          "--disable-slash-commands", "--disallowedTools", [...CLAUDE_FORBIDDEN_TOOLS].join(","),
          // headless --print 没有应答 manual 审批的控制通道，write 会话会被自动拒绝。
          // 可写成员按部署方要求使用 --dangerously-skip-permissions；
          // 叶子约束仍由 --disallowedTools、工作区租约与写后冲突检测在外层保障。
          ...(request.accessMode === "write"
            ? ["--dangerously-skip-permissions"]
            : ["--permission-mode", "manual"]),
          ...(request.accessMode === "read" ? ["--tools", "Read,Glob,Grep"] : []),
          ...claudeModelArgs(this.defaultModel),
          ...this.outputSchemaArgs(),
          ...this.resumeArgs(request.resumeNativeSessionId),
          ...validateClaudeConfiguredArgs(this.configuredArgs),
        ],
      },
      accessMode: request.accessMode,
      cwd: request.workspace.path,
      stdin: buildClaudePrompt(request),
      envAllowlist: CLAUDE_ENV_ALLOWLIST,
      outerSandboxReady: true,
      networkProfile: request.networkProfile,
      allowTrustedRuntimeEntry: "claude",
      supervisor: {
        timeoutMs: Math.min(request.timeoutMs, request.budget.wallTimeMs),
        maxOutputBytes: request.budget.maxOutputBytes,
      },
      task: { taskId: request.taskId, attemptId: request.attemptId, runtimeId: request.runtimeId },
    });
    this.handles.set(request.taskId, handle);
    let completed = false;
    try {
      yield* this.consume(request, handle);
      completed = true;
    } finally {
      // 解析失败/消费者退出不表示子进程停止；先监督收口，再允许上层释放工作目录租约。
      if (!completed) await stopClaudeProcess(handle);
      this.handles.delete(request.taskId);
    }
  }

  private outputSchemaArgs(): string[] {
    if (this.outputSchema === undefined) return [];
    let serialized: string;
    try {
      serialized = JSON.stringify(this.outputSchema);
    } catch {
      throw new Error("Invalid Claude output schema: not serializable");
    }
    if (!serialized || serialized.length > 8192) {
      throw new Error("Invalid Claude output schema: empty or oversized");
    }
    return ["--json-schema", serialized];
  }

  private resumeArgs(sessionId: string | undefined): string[] {
    if (sessionId === undefined || sessionId.trim() === "") return [];
    const value = sessionId.trim();
    if (value.startsWith("-") || value.includes(String.fromCharCode(0))) {
      throw new Error("Invalid Claude resume session id");
    }
    return ["--resume", value];
  }

  async interrupt(handle: { taskId: string }): Promise<void> {
    await this.handles.get(handle.taskId)?.interrupt();
  }

  async cancel(handle: { taskId: string }): Promise<void> {
    await this.handles.get(handle.taskId)?.cancel();
  }

  private definition() {
    return {
      id: this.id,
      kind: "external" as const,
      binary: "claude",
      ...(this.minimumVersion ? { minimumVersion: this.minimumVersion } : {}),
      ...(this.testedVersion ? { testedVersion: this.testedVersion } : {}),
      ...(this.testedRange ? { testedRange: this.testedRange } : {}),
      versionProbeArgs: ["--version"] as readonly string[],
      helpProbeArgs: [HELP_ARGS] as readonly (readonly string[])[],
      authProbeArgs: ["auth", "status"] as readonly string[],
      capabilityProbes: [
        capabilityProbe("structuredOutput", [["--output-format"]]),
        capabilityProbe("structuredTerminalResult", [["--json-schema"]]),
        capabilityProbe("permissionMode", [["--permission-mode", "manual"]]),
      ],
      leafProfileProbes: [{ args: HELP_ARGS, includesAll: ["--disallowedTools", "--disable-slash-commands", "--tools", "manual"] }],
    };
  }

  private async *consume(
    request: ExternalRuntimeTaskRequest,
    handle: ExternalRuntimeProcessHandle,
  ): AsyncIterable<ExternalRuntimeEventEnvelope> {
    let sequence = 1;
    let nativeSessionId: string | undefined;
    let terminal: ExternalRuntimeResult | undefined;
    const envelope: EnvelopeFn = (type, payload, sessionId) => {
      const resolvedSessionId = sessionId ?? nativeSessionId;
      return {
        schemaVersion: 1,
        eventId: this.eventId(sequence),
        sequence: sequence++,
        taskId: request.taskId,
        attemptId: request.attemptId,
        runtimeId: request.runtimeId,
        ...(resolvedSessionId ? { nativeSessionId: resolvedSessionId } : {}),
        timestamp: this.now().toISOString(),
        type,
        payload,
      };
    };
    const onSessionId = (id: string | undefined) => {
      nativeSessionId = id ?? nativeSessionId;
    };
    yield envelope("task.started", { runtimeState: "running" });
    let remainder = "";
    let stderrTail = "";
    for await (const chunk of handle.output) {
      // stderr 只作诊断，不能把其中 JSON 误认成成功终态或拼接进 stdout 事件。
      // 但进程非零退出时它是唯一线索：保留有界尾部，脱敏后进入错误消息。
      if (chunk.stream === "stderr") {
        stderrTail = `${stderrTail}${chunk.data}`.slice(-STDERR_TAIL_CHARS);
        yield envelope("warning", { nativeType: "stderr" });
        continue;
      }
      const drained = this.consumeBuffered(remainder + chunk.data, false, envelope, onSessionId);
      remainder = drained.remainder;
      if (drained.terminal) terminal = this.terminalResult(request, drained.terminal);
      yield* drained.events;
    }
    const tail = this.consumeBuffered(remainder, true, envelope, onSessionId);
    if (tail.terminal) terminal = this.terminalResult(request, tail.terminal);
    yield* tail.events;
    const exit = await handle.completed;
    if (exit.reason === "cancelled" || exit.reason === "interrupt") {
      yield envelope("task.completed", ExternalRuntimeResultSchema.parse({
        schemaVersion: 1, taskId: request.taskId, attemptId: request.attemptId, runtimeId: request.runtimeId,
        status: "cancelled", runtimeState: "cancelled", summary: "External runtime cancelled",
        completedAt: this.now().toISOString(), artifacts: [],
      }));
      return;
    }
    if (exit.reason !== "exit" || exit.exitCode !== 0)
      throw new Error(
        `protocol_error: Claude process did not exit successfully (reason=${exit.reason}, exitCode=${exit.exitCode ?? "null"}, signal=${exit.signal ?? "none"})${stderrTail.trim() ? `; stderr: ${redactExternalStderr(stderrTail.trim())}` : ""}`,
      );
    if (!terminal) {
      throw new Error("protocol_error: external runtime ended without a terminal result");
    }
    yield envelope("task.completed", terminal);
  }

  private consumeBuffered(
    buffered: string,
    final: boolean,
    envelope: EnvelopeFn,
    onSessionId: (id: string | undefined) => void,
  ): { events: ExternalRuntimeEventEnvelope[]; terminal?: ClaudeNativeEvent; remainder: string } {
    const events: ExternalRuntimeEventEnvelope[] = [];
    let terminal: ClaudeNativeEvent | undefined;
    let remainder = buffered;
    let boundary = remainder.indexOf("\n");
    while (boundary >= 0) {
      const parsed = this.consumeLine(remainder.slice(0, boundary).trim(), envelope, onSessionId);
      terminal ??= parsed.terminal;
      events.push(...parsed.events);
      remainder = remainder.slice(boundary + 1);
      boundary = remainder.indexOf("\n");
    }
    if (final && remainder.trim()) {
      const parsed = this.consumeLine(remainder.trim(), envelope, onSessionId);
      terminal ??= parsed.terminal;
      events.push(...parsed.events);
      remainder = "";
    }
    return { events, terminal, remainder };
  }

  private consumeLine(
    line: string,
    envelope: EnvelopeFn,
    onSessionId: (id: string | undefined) => void,
  ): { events: ExternalRuntimeEventEnvelope[]; terminal?: ClaudeNativeEvent } {
    if (!line) return { events: [] };
    let native: ClaudeNativeEvent;
    try {
      native = ClaudeNativeEventSchema.parse(JSON.parse(line));
    } catch {
      return { events: [envelope("warning", { nativeType: "malformed", raw: line.slice(0, 2000) })] };
    }
    if (native.session_id) onSessionId(native.session_id);
    if (isClaudeLeafEvent(native)) {
      throw new Error(`policy_violation: external runtime attempted delegation (${native.type})`);
    }
    if (native.type === "result") return { events: [], terminal: native };
    const events = translateClaudeEvent(native).map((translated) =>
      envelope(translated.type, translated.payload, translated.nativeSessionId),
    );
    return { events };
  }

  private terminalResult(request: ExternalRuntimeTaskRequest, native: ClaudeNativeEvent): ExternalRuntimeResult {
    const record = native as Record<string, unknown>;
    const structured = ClaudeFinalOutputSchema.safeParse(record.structured_output);
    // vendor 明确报错优先于模型自报成功，避免错误结果被群板提升为成功。
    const failed = native.is_error === true || native.subtype !== "success";
    const finish = (
      summary: string,
      status: "succeeded" | "failed" | "cancelled",
      artifacts: string[],
    ) =>
      ExternalRuntimeResultSchema.parse({
        schemaVersion: 1,
        taskId: request.taskId,
        attemptId: request.attemptId,
        runtimeId: request.runtimeId,
        status,
        runtimeState: status,
        summary: summary.slice(0, 8000) || "(no output)",
        completedAt: this.now().toISOString(),
        ...(native.session_id ? { nativeSessionId: native.session_id } : {}),
        artifacts,
      });
    if (!structured.success) {
      // 弱模型经常写不出 JSON。绝不能因此把整个任务判成 protocol_error 而丢掉产出：
      // 用 vendor 的 result 明文兜底为 summary，链路是否继续交给上层的标签/@ 判定。
      const plain = (typeof record.result === "string" ? record.result : "").trim();
      if (failed) return finish(plain || "external runtime reported failure", "failed", []);
      if (plain) return finish(plain, "succeeded", []);
      throw new Error("protocol_error: external runtime terminal result is not structured");
    }
    const status = failed ? "failed" : structured.data.status ?? "succeeded";
    return finish(structured.data.summary, status, structured.data.artifacts);
  }
}
