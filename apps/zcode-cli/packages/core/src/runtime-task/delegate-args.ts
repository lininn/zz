import type {
  ExternalRuntimeAccessMode,
  ExternalRuntimeNetworkProfile,
  ExternalRuntimeRole,
} from "@zcode/contracts";

export interface DelegateCommandInput {
  runtimeId?: string;
  role: ExternalRuntimeRole;
  accessMode: ExternalRuntimeAccessMode;
  executionMode: "sequential" | "parallel";
  chatTaskId?: string;
  objective: string;
  verificationCommands: string[][];
  skipVerification: boolean;
  networkProfile: ExternalRuntimeNetworkProfile;
  allowDirtyWorkspace: boolean;
  useWorktree: boolean;
  unsafeTextFallback: boolean;
}

const READ_ONLY_ROLES: readonly ExternalRuntimeRole[] = ["reviewer", "researcher", "explore"];
const ROLES: readonly ExternalRuntimeRole[] = [
  "reviewer",
  "researcher",
  "explore",
  "executor",
  "debugger",
  "general",
];
const NETWORK_PROFILES: readonly ExternalRuntimeNetworkProfile[] = ["allowed", "restricted", "disabled"];

function isRole(value: string): value is ExternalRuntimeRole {
  return (ROLES as readonly string[]).includes(value);
}

function isNetworkProfile(value: string): value is ExternalRuntimeNetworkProfile {
  return (NETWORK_PROFILES as readonly string[]).includes(value);
}

export function parseDelegateArguments(args: string, fixedRuntimeId?: string): DelegateCommandInput {
  const tokens = splitArguments(args);
  let runtimeId = fixedRuntimeId;
  let role: ExternalRuntimeRole = "general";
  let explicitAccess: ExternalRuntimeAccessMode | undefined;
  let executionMode: "sequential" | "parallel" = "sequential";
  let chatTaskId: string | undefined;
  const verificationCommands: string[][] = [];
  let skipVerification = false;
  let networkProfile: ExternalRuntimeNetworkProfile = "restricted";
  let allowDirtyWorkspace = false;
  let useWorktree = false;
  let unsafeTextFallback = false;
  const objectiveParts: string[] = [];

  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index]!;
    if (token === "--runtime") {
      const value = tokens[index + 1];
      if (!value) throw new Error("delegate: --runtime requires a value");
      if (fixedRuntimeId && value !== fixedRuntimeId) {
        throw new Error(`delegate: runtime is fixed to ${fixedRuntimeId}`);
      }
      runtimeId = value;
      index += 2;
    } else if (token === "--role") {
      const value = tokens[index + 1];
      if (!value || !isRole(value)) throw new Error(`delegate: unsupported role: ${value ?? "(missing)"}`);
      role = value;
      index += 2;
    } else if (token === "--read-only") {
      explicitAccess = "read";
      index += 1;
    } else if (token === "--write") {
      explicitAccess = "write";
      index += 1;
    } else if (token === "--verify") {
      const value = tokens[index + 1];
      if (!value) throw new Error("delegate: --verify requires a command");
      verificationCommands.push(splitArguments(value));
      index += 2;
    } else if (token === "--skip-verification") {
      skipVerification = true;
      index += 1;
    } else if (token === "--network") {
      const value = tokens[index + 1];
      if (!value || !isNetworkProfile(value)) {
        throw new Error(`delegate: unsupported network profile: ${value ?? "(missing)"}`);
      }
      networkProfile = value;
      index += 2;
    } else if (token === "--allow-dirty") {
      allowDirtyWorkspace = true;
      index += 1;
    } else if (token === "--worktree") {
      useWorktree = true;
      index += 1;
    } else if (token === "--unsafe-text-fallback") {
      unsafeTextFallback = true;
      index += 1;
    } else if (token === "--parallel") {
      executionMode = "parallel";
      index += 1;
    } else if (token === "--chat") {
      const value = tokens[index + 1];
      if (!value) throw new Error("delegate: --chat requires a task id");
      chatTaskId = value;
      index += 2;
    } else if (token.startsWith("--")) {
      throw new Error(`delegate: unknown flag: ${token}`);
    } else {
      objectiveParts.push(token);
      index += 1;
    }
  }

  const objective = objectiveParts.join(" ").trim();
  if (!objective) throw new Error("delegate: an objective is required");
  const accessMode = explicitAccess ?? (READ_ONLY_ROLES.includes(role) ? "read" : "write");
  if (accessMode === "write" && READ_ONLY_ROLES.includes(role)) {
    throw new Error(`delegate: role ${role} cannot run write tasks`);
  }
  if (skipVerification && verificationCommands.length > 0) {
    throw new Error("delegate: --skip-verification conflicts with --verify");
  }
  return {
    ...(runtimeId ? { runtimeId } : {}),
    role,
    accessMode,
    executionMode,
    ...(chatTaskId ? { chatTaskId } : {}),
    objective,
    verificationCommands,
    skipVerification,
    networkProfile,
    allowDirtyWorkspace,
    useWorktree,
    unsafeTextFallback,
  };
}

function splitArguments(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;
  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escaping) current += "\\";
  if (current) args.push(current);
  return args;
}
