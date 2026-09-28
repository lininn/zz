import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExternalRuntimePort,
  ExternalRuntimeTaskRequest,
  ExternalRuntimeHandle,
  ExternalRuntimeEventEnvelope,
} from "@zcode/contracts";
import { translateCodexEvent } from "./codex-events.js";
import { VendorRuntimeSessions } from "./vendor-runtime-sessions.js";
import {
  buildVendorPrompt,
  probeVendor,
  safeArgument,
  validateVendorOptions,
  VENDOR_ENV_ALLOWLIST,
  VENDOR_FINAL_JSON_SCHEMA,
  type VendorCliAdapterOptions,
} from "./vendor-cli-support.js";

export const CODEX_RUNTIME_ID = "codex-cli";
export interface CodexCliAdapterOptions extends VendorCliAdapterOptions {}
const EXEC_HELP = ["exec", "--help"] as const;
const RESUME_HELP = ["exec", "resume", "--help"] as const;
const ROOT_HELP = ["--help"] as const;
const FEATURES = ["features", "list"] as const;
const DISABLED_FEATURES = ["multi_agent", "multi_agent_v2", "plugins", "hooks"] as const;
const MAX_SCHEMA_LENGTH = 8192;

export class CodexCliAdapter implements ExternalRuntimePort {
  readonly id = CODEX_RUNTIME_ID;
  private readonly sessions: VendorRuntimeSessions;
  constructor(private readonly options: CodexCliAdapterOptions) {
    this.sessions = new VendorRuntimeSessions(options);
  }

  probe(context: { runtimeId: string; requiredCapabilities: string[] }) {
    const runner = this.options.preflightRunner;
    const options = {
      ...this.options,
      preflightRunner: runner
        ? {
            findBinary: (binary: string) => runner.findBinary(binary),
            run: async (binary: string, args: readonly string[]) => {
              const result = await runner.run(binary, args);
              if (args[0] !== "features") return result;
              // 同名前缀和 removed/deprecated 项不能证明 feature 能被有效禁用。
              const verified = result.stdout.split("\n").flatMap((line) => {
                const match = line.match(/^(\S+)\s+(.+?)\s+(?:true|false)\s*$/);
                return match && !/removed|deprecated/.test(match[2]!) ? [match[1]!] : [];
              });
              return { ...result, stdout: `\n${verified.join("\n")}\n`, stderr: "" };
            },
          }
        : undefined,
    };
    return probeVendor(
      options,
      {
        id: this.id,
        kind: "external",
        binary: "codex",
        versionProbeArgs: ["--version"],
        helpProbeArgs: [ROOT_HELP, EXEC_HELP, RESUME_HELP, FEATURES],
        authProbeArgs: ["login", "status"],
        capabilityProbes: [
          { args: EXEC_HELP, capability: "structuredOutput", includesAny: [["--json"]] },
          {
            args: EXEC_HELP,
            capability: "structuredTerminalResult",
            includesAny: [["--output-schema"]],
          },
          {
            args: ROOT_HELP,
            capability: "permissionMode",
            includesAny: [
              ["--ask-for-approval", "never", "--sandbox", "read-only", "workspace-write"],
            ],
          },
        ],
        leafProfileProbes: [
          { args: EXEC_HELP, includesAll: ["--disable", "--ignore-user-config", "--ignore-rules"] },
          { args: ROOT_HELP, includesAll: ["--ask-for-approval", "never", "--sandbox"] },
          { args: RESUME_HELP, includesAll: ["SESSION_ID", "--json", "--output-schema"] },
          { args: FEATURES, includesAll: DISABLED_FEATURES.map((feature) => `\n${feature}\n`) },
        ],
      },
      context.requiredCapabilities,
      { leaf: true, resume: true },
    );
  }

  async *start(request: ExternalRuntimeTaskRequest): AsyncIterable<ExternalRuntimeEventEnvelope> {
    if (request.runtimeId !== this.id)
      throw new Error(`Codex adapter cannot run ${request.runtimeId}`);
    if (!this.options.outerSandboxReady)
      throw new Error("Cannot start Codex before the outer sandbox is ready");
    validateVendorOptions(this.options);
    const nativeId =
      request.resumeNativeSessionId === undefined
        ? undefined
        : safeArgument(request.resumeNativeSessionId, "Codex resume session id");
    let schema: string;
    try {
      schema = JSON.stringify(this.options.outputSchema ?? VENDOR_FINAL_JSON_SCHEMA);
    } catch {
      throw new Error("Invalid Codex output schema");
    }
    if (!schema || schema.length > MAX_SCHEMA_LENGTH)
      throw new Error("Invalid Codex output schema");
    const directory = await mkdtemp(join(tmpdir(), "crew-codex-schema-"));
    let runtimeFailed = false;
    try {
      const schemaFile = join(directory, "final.json");
      await writeFile(schemaFile, schema, { mode: 0o600 });
      const args = [
        "exec",
        // exec 子命令参数：可写成员按部署方要求使用 yolo（跳过审批与沙箱）；
        // 只读仍走 read-only 沙箱。顶层传 --ask-for-approval/--sandbox 会 argv
        // 解析失败 exit 2（0.157 实测）。叶子约束由 --disable features 与外层护栏保障。
        ...(request.accessMode === "write"
          ? ["--dangerously-bypass-approvals-and-sandbox"]
          : ["-s", "read-only"]),
        // 不传 --ignore-user-config：它会丢弃用户 config.toml 的自定义 model
        // provider（本地代理等），导致回退官方端点 401 重试后失败（0.157 实测）。
        // 用户配置是可信输入；确定性由 --disable features 与沙箱参数保障。
        "--ignore-rules",
        ...DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
        ...(request.accessMode === "read" && request.networkProfile === "allowed"
          ? []
          : request.accessMode === "read"
            ? ["-c", "sandbox_workspace_write.network_access=false"]
            : []),
        ...(nativeId ? ["resume", nativeId] : []),
        "--json",
        "--output-schema",
        schemaFile,
        ...(this.options.defaultModel
          ? ["--model", safeArgument(this.options.defaultModel, "Codex model")]
          : []),
        // --ignore-user-config 使 codex 读不到 trusted-projects 信任记录，任何 git
        // 目录都会在启动校验报 "Not inside a trusted directory"（0.157 实测 exit 1）。
        // 工作区边界由 zcode 自身 gate 与 codex sandbox 保障，这里必须始终跳过检查。
        "--skip-git-repo-check",
        "-",
      ];
      yield* this.sessions.run(
        request,
        {
          command: { executable: this.options.binaryPath ?? "codex", args },
          cwd: request.workspace.path,
          stdin: buildVendorPrompt(request),
          envAllowlist: VENDOR_ENV_ALLOWLIST,
          accessMode: request.accessMode,
          networkProfile: request.networkProfile,
          outerSandboxReady: true,
          allowTrustedRuntimeEntry: "codex",
          supervisor: { timeoutMs: Math.min(request.timeoutMs, request.budget.wallTimeMs) },
          task: {
            taskId: request.taskId,
            attemptId: request.attemptId,
            runtimeId: request.runtimeId,
          },
        },
        translateCodexEvent,
      );
    } catch (error) {
      runtimeFailed = true;
      throw error;
    } finally {
      await this.removeSchemaDirectory(directory, runtimeFailed);
    }
  }

  private async removeSchemaDirectory(
    directory: string,
    preserveRuntimeError: boolean,
  ): Promise<void> {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      // 临时 schema 清理失败不得覆盖 recovery_required，否则上层可能误释放执行租约。
      if (!preserveRuntimeError) throw error;
    }
  }

  interrupt(handle: ExternalRuntimeHandle): Promise<void> {
    return this.sessions.interrupt(handle);
  }
  cancel(handle: ExternalRuntimeHandle): Promise<void> {
    return this.sessions.cancel(handle);
  }
}
