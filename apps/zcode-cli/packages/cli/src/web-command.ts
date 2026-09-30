import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import type { RunContext } from "@zcode/shared-types";

// CJS bundle 里 import.meta 是空的（esbuild 警告），用 __dirname 代替
const thisDir = typeof __dirname === "string" ? __dirname : dirname(fileURLToPath(import.meta.url));

export const DEFAULT_WEB_PORT = 3030;
const PORT_RETRY_COUNT = 10;

export interface WebCommandOptions {
  readonly port?: number;
  readonly openBrowser?: boolean;
}

export function resolveWebPort(rawPort: string | undefined): number {
  if (rawPort === undefined) return DEFAULT_WEB_PORT;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--web-port 必须是 1-65535 的整数（收到: ${rawPort}）`);
  }
  return port;
}

/**
 * 解析 web-dist 路径：优先用环境变量 ZCODE_WEB_STATIC_ROOT，
 * 否则相对于 CLI bundle 所在目录查找 web/ 子目录，
 * 最后回退到 monorepo 中 packages/web/dist（开发模式）。
 */
function resolveWebDistPath(): string | undefined {
  const envRoot = process.env["ZCODE_WEB_STATIC_ROOT"]?.trim();
  if (envRoot) return envRoot;

  // npm 安装后 web-dist 与 CLI bundle 同级目录的 web/ 下
  const candidate = resolve(thisDir, "web");
  if (existsSync(candidate) && statSync(candidate).isDirectory()) return candidate;

  // 开发模式回退：从 cli/src/ 向上找到 monorepo root 的 packages/web/dist
  const monorepoWebDist = resolve(thisDir, "../../../../../packages/web/dist");
  if (existsSync(monorepoWebDist) && statSync(monorepoWebDist).isDirectory()) return monorepoWebDist;

  return undefined;
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // 浏览器启动失败不影响 web 服务
  }
}

function tryListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    const onError = (error: NodeJS.ErrnoException) => {
      server.close();
      resolve(error.code === "EADDRINUSE" ? false : false);
    };
    server.once("error", onError);
    server.listen(port, host, () => {
      server.close();
      resolve(true);
    });
  });
}

/**
 * 找到 server entry-http.js 的路径。
 * 构建后位于 packages/server/dist/entry-http.js 或通过 require.resolve 解析。
 */
function resolveServerEntryPath(): string {
  // 优先从 monorepo 中查找（开发模式）
  const monorepoServerEntry = resolve(
    thisDir, "../../../../../packages/server/dist/entry-http.js",
  );
  if (existsSync(monorepoServerEntry)) return monorepoServerEntry;

  // npm 安装后 server 包在 node_modules/@zcode/server
  try {
    const req = createRequire(typeof __dirname === "string" ? `file://${__dirname}/` : import.meta.url);
    return req.resolve("@zcode/server/dist/entry-http.js");
  } catch {
    // 降级
  }

  // 最终降级：返回 monorepo 路径（运行时会报错但至少有信息）
  return monorepoServerEntry;
}

/** zz --web 入口：启动本地 Web 聊天页面并阻塞到退出信号。 */
export async function runWebCommand(
  ctx: RunContext,
  options: WebCommandOptions = {},
): Promise<number> {
  const staticRoot = resolveWebDistPath();
  const requestedPort = options.port ?? DEFAULT_WEB_PORT;
  const host = "127.0.0.1";

  // 探测可用端口
  let actualPort = requestedPort;
  for (let attempt = 0; attempt < PORT_RETRY_COUNT; attempt += 1) {
    const ok = await tryListen(actualPort, host);
    if (ok) break;
    if (attempt === PORT_RETRY_COUNT - 1) {
      ctx.stderr.write(
        `无法监听 ${host}:${requestedPort}-${actualPort}（已尝试 ${PORT_RETRY_COUNT} 个端口）\n`,
      );
      return 1;
    }
    actualPort += 1;
  }

  // 启动 server 子进程
  const serverEntry = resolveServerEntryPath();
  const env: Record<string, string | undefined> = {
    ...process.env,
    PORT: String(actualPort),
    ZCODE_SERVER_HOST: host,
    ...(staticRoot ? { ZCODE_WEB_STATIC_ROOT: staticRoot } : {}),
  };

  let serverProc: ChildProcess | undefined;
  try {
    serverProc = spawn(process.execPath, [serverEntry], {
      env: env as Record<string, string>,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`启动 server 失败: ${message}\n`);
    return 1;
  }

  // 转发 server stdout/stderr
  serverProc.stdout?.on("data", (chunk: Buffer) => {
    ctx.stdout.write(chunk);
  });
  serverProc.stderr?.on("data", (chunk: Buffer) => {
    ctx.stderr.write(chunk);
  });

  const url = `http://${host}:${actualPort}`;

  ctx.stdout.write(`\n  ⚡ ZCode Web 已启动: ${url}\n\n`);
  if (actualPort !== requestedPort) {
    ctx.stdout.write(`  提示: 端口 ${requestedPort} 被占用，已自动切换到 ${actualPort}。\n\n`);
  }
  if (!staticRoot) {
    ctx.stdout.write(`  提示: 未找到 web-dist 目录，仅 RPC 接口可用。\n`);
    ctx.stdout.write(`  设置 ZCODE_WEB_STATIC_ROOT 环境变量可指定 web 页面目录。\n\n`);
  }
  ctx.stdout.write(`  按 Ctrl-C 退出。\n\n`);

  if (options.openBrowser !== false) openBrowser(url);

  // 阻塞到退出信号或 server 子进程退出
  const exitPromise = new Promise<number>((resolve) => {
    serverProc?.on("exit", (code) => {
      resolve(code ?? 0);
    });
  });

  const signalPromise = new Promise<void>((resolve) => {
    const signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
    const onSignal = () => {
      for (const signal of signals) process.removeListener(signal, onSignal);
      resolve();
    };
    for (const signal of signals) process.on(signal, onSignal);
  });

  await Promise.race([exitPromise, signalPromise]);

  // 清理：向 server 子进程发 SIGTERM
  if (serverProc && !serverProc.killed) {
    serverProc.kill("SIGTERM");
  }

  return 0;
}
