import { stripVTControlCharacters } from "node:util";
import type {
  ExternalRuntimePort,
  ExternalRuntimeTaskRequest,
  ExternalRuntimeHandle,
  ExternalRuntimeEventEnvelope,
} from "@zcode/contracts";
import { translateOpenCodeEvent } from "./opencode-events.js";
import { VendorRuntimeSessions } from "./vendor-runtime-sessions.js";
import {
  buildVendorPrompt,
  probeVendor,
  safeArgument,
  validateVendorOptions,
  VENDOR_ENV_ALLOWLIST,
  type VendorCliAdapterOptions,
} from "./vendor-cli-support.js";

export const OPENCODE_RUNTIME_ID = "opencode-cli";
export interface OpenCodeCliAdapterOptions extends VendorCliAdapterOptions {}
const RUN_HELP = ["run", "--help"] as const;

export class OpenCodeCliAdapter implements ExternalRuntimePort {
  readonly id = OPENCODE_RUNTIME_ID;
  private readonly sessions: VendorRuntimeSessions;
  constructor(private readonly options: OpenCodeCliAdapterOptions) {
    this.sessions = new VendorRuntimeSessions(options);
  }

  probe(context: { runtimeId: string; requiredCapabilities: string[] }) {
    const runner = this.options.preflightRunner;
    return probeVendor(
      {
        ...this.options,
        preflightRunner: runner
          ? {
              findBinary: (binary) => runner.findBinary(binary),
              run: async (binary, args) => {
                const result = await runner.run(binary, args);
                if (args[0] !== "auth") return result;
                // auth list 空列表也可能 exit 0，不能把命令执行成功当作已认证。
                const text = stripVTControlCharacters(`${result.stdout}\n${result.stderr}`);
                return {
                  exitCode:
                    result.exitCode === 0 && /\b[1-9]\d* credentials?\b/i.test(text) ? 0 : 1,
                  stdout: "",
                  stderr: "",
                };
              },
            }
          : undefined,
      },
      {
        id: this.id,
        kind: "external",
        binary: "opencode",
        versionProbeArgs: ["--version"],
        helpProbeArgs: [RUN_HELP],
        authProbeArgs: ["auth", "list"],
        capabilityProbes: [
          { args: RUN_HELP, capability: "structuredOutput", includesAny: [["--format", "json"]] },
        ],
        // 实测无 schema/leaf/permission-reply flags：不虚构参数，也不启用 --auto。
        leafProfileProbes: [{ args: RUN_HELP, includesAll: ["--pure", "--session"] }],
      },
      context.requiredCapabilities,
      { leaf: false, resume: true },
    );
  }

  async *start(request: ExternalRuntimeTaskRequest): AsyncIterable<ExternalRuntimeEventEnvelope> {
    if (request.runtimeId !== this.id)
      throw new Error(`OpenCode adapter cannot run ${request.runtimeId}`);
    if (!this.options.outerSandboxReady)
      throw new Error("Cannot start OpenCode before the outer sandbox is ready");
    validateVendorOptions(this.options);
    if (this.options.outputSchema)
      throw new Error("runtime_unavailable: OpenCode has no verified output schema flag");
    const nativeId =
      request.resumeNativeSessionId === undefined
        ? undefined
        : safeArgument(request.resumeNativeSessionId, "OpenCode resume session id");
    yield* this.sessions.run(
      request,
      {
        command: {
          executable: this.options.binaryPath ?? "opencode",
          args: [
            "run",
            "--pure",
            "--format",
            "json",
            ...(nativeId ? ["--session", nativeId] : []),
            ...(this.options.defaultModel
              ? ["--model", safeArgument(this.options.defaultModel, "OpenCode model")]
              : []),
            "--",
            buildVendorPrompt(request),
          ],
        },
        cwd: request.workspace.path,
        stdin: "",
        envAllowlist: VENDOR_ENV_ALLOWLIST,
        accessMode: request.accessMode,
        networkProfile: request.networkProfile,
        outerSandboxReady: true,
        allowTrustedRuntimeEntry: "opencode",
        supervisor: { timeoutMs: Math.min(request.timeoutMs, request.budget.wallTimeMs) },
        task: {
          taskId: request.taskId,
          attemptId: request.attemptId,
          runtimeId: request.runtimeId,
        },
      },
      translateOpenCodeEvent,
    );
  }

  interrupt(handle: ExternalRuntimeHandle): Promise<void> {
    return this.sessions.interrupt(handle);
  }
  cancel(handle: ExternalRuntimeHandle): Promise<void> {
    return this.sessions.cancel(handle);
  }
}
