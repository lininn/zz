import { z } from "zod";
import type { ExternalRuntimeCapabilityReport, ExternalRuntimeTaskRequest } from "@zcode/contracts";
import type { ExternalRuntimeProcessHost } from "./process-host.js";
import {
  ExternalRuntimeRegistry,
  runExternalRuntimePreflight,
  toCapabilityReport,
  type ExternalRuntimeDefinition,
  type ProbeCommandRunner,
} from "./preflight.js";

export interface VendorCliAdapterOptions {
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

export const VendorFinalOutputSchema = z
  .object({
    summary: z.string().min(1).max(8000),
    status: z.enum(["succeeded", "failed", "cancelled"]).optional(),
    artifacts: z.array(z.string().min(1).max(512)).default([]),
  })
  .strict();

export const VENDOR_FINAL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "status", "artifacts"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 8000 },
    status: { type: "string", enum: ["succeeded", "failed", "cancelled"] },
    artifacts: { type: "array", items: { type: "string" } },
  },
};

// 只传本地认证路径，不继承 API key、token 或任意插件环境变量。
export const VENDOR_ENV_ALLOWLIST = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "CODEX_HOME",
] as const;

export type VendorNativeEvent = Record<string, unknown> & { type: string };
export interface VendorTranslatedEvent {
  type: string;
  payload: unknown;
  nativeSessionId?: string;
  finalText?: string;
  terminal?: "succeeded" | "failed";
  failure?: string;
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function safeArgument(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("-") || /\p{Cc}/u.test(trimmed)) {
    throw new Error(`Invalid ${name}`);
  }
  return trimmed;
}

export function validateVendorOptions(options: VendorCliAdapterOptions): void {
  // P1 未确认任何可安全透传的额外参数，禁止配置绕过固定沙箱/审批策略。
  if (options.configuredArgs?.length) throw new Error("Unsafe vendor configured argument");
  if (options.defaultModel !== undefined)
    safeArgument(options.defaultModel, "vendor default model");
}

export function buildVendorPrompt(request: ExternalRuntimeTaskRequest): string {
  return [
    request.objective,
    "",
    "Boundaries:",
    ...request.boundaries.map((boundary) => `- ${boundary}`),
    "- Remain a leaf worker. Do not delegate or invoke zcode, claude, codex, or opencode.",
    "Finish by describing what you did in plain text. JSON is OPTIONAL: if you can emit it reliably, you may end with {\"summary\": \"...\", \"status\": \"succeeded\"|\"failed\", \"artifacts\": [...]}; otherwise plain prose is fine and is used as-is.",
    "If another member should continue, mention them by name in your final reply (for example \"@设计师 …\"); that alone hands the task over.",
  ].join("\n");
}

export async function probeVendor(
  options: VendorCliAdapterOptions,
  definition: ExternalRuntimeDefinition,
  requiredCapabilities: string[],
  extra: { leaf: boolean; resume: boolean },
): Promise<ExternalRuntimeCapabilityReport> {
  if (!options.preflightRunner)
    throw new Error(`${definition.id} adapter requires a preflight runner`);
  const report = await runExternalRuntimePreflight({
    runtimeId: definition.id,
    access: "read",
    binary: options.binaryPath ?? definition.binary,
    runner: options.preflightRunner,
    registry: new ExternalRuntimeRegistry([
      {
        ...definition,
        minimumVersion: options.minimumVersion,
        testedVersion: options.testedVersion,
        testedRange: options.testedRange,
      },
    ]),
    outerIsolation: options.outerSandboxReady,
    leafEnforcement: {
      toolAndFeatureDeny: extra.leaf,
      commandDeny: extra.leaf,
      eventMonitoring: true,
      resourceLimits: true,
    },
  });
  const result = toCapabilityReport(report, {
    runtimeId: definition.id,
    requiredCapabilities,
    now: options.now,
  });
  result.capabilities.permissionReplies = false;
  result.capabilities.resume = extra.resume && result.capabilities.leafEnforcement === true;
  // 既有 toCapabilityReport 只携带 requiredCapabilities；新增 adapter 必须明确拒绝缺失项。
  for (const capability of requiredCapabilities) {
    if (result.capabilities[capability] !== true) {
      result.available = false;
      result.warnings.push(`required_capability_missing:${capability}`);
    }
  }
  return result;
}
