import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ZCodeAgentCommandResolver } from "@zcode/services/node";

/** 仅由 HTTP 开发入口显式注入；生产/桌面/远程仍使用原有 resolver。 */
export function createDevelopmentAgentCommandResolver(
  repositoryRoot: string,
  fallback: ZCodeAgentCommandResolver,
  env: NodeJS.ProcessEnv = process.env,
): ZCodeAgentCommandResolver {
  return async (context) => {
    if (env.ZCODE_AGENT_SERVER_COMMAND?.trim()) return fallback(context);
    const source = join(repositoryRoot, "apps/zcode-cli/packages/cli/src/main.ts");
    await access(source);
    const loader = createRequire(join(repositoryRoot, "package.json")).resolve("tsx");
    // 旧 Web dev 优先命中陈旧 dist，导致新 crew/runtime 协议不可达；必须运行当前源码，
    // 不能用宿主探测结果伪造 Agent 可用性，也不能在缺依赖时静默退回旧 bundle。
    return {
      command: process.execPath,
      args: ["--import", pathToFileURL(loader).href, source, "app-server", "--stdio"],
      cwd: context.workspacePath,
      supportsStorageStartup: true,
    };
  };
}
