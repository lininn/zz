import { spawn } from "node:child_process";
import type { RunContext } from "@zcode/shared-types";
import { startWebConfigServer } from "./server.js";

export const DEFAULT_WEB_CONFIG_PORT = 3210;

export interface WebConfigCommandOptions {
  readonly port?: number;
  readonly openBrowser?: boolean;
}

export function resolveWebConfigPort(rawPort: string | undefined): number {
  if (rawPort === undefined) return DEFAULT_WEB_CONFIG_PORT;
  return parsePort(rawPort, "--web-port");
}

function parsePort(value: string, source: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${source} 必须是 1-65535 的整数（收到: ${value}）`);
  }
  return port;
}

function openBrowser(url: string): void {
  // 尽力而为：打不开浏览器时用户仍可手动访问打印出的地址。
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
    // 忽略：浏览器启动失败不影响配置服务。
  }
}

/** zz --web-config 入口：启动本地配置页并阻塞到退出信号。 */
export async function runWebConfigCommand(
  ctx: RunContext,
  options: WebConfigCommandOptions = {},
): Promise<number> {
  const requestedPort = options.port ?? resolveWebConfigPort(undefined);
  const handle = await startWebConfigServer({ port: requestedPort });
  const url = `http://127.0.0.1:${handle.port}`;

  ctx.stdout.write(`ZCode Web 配置已启动: ${url}\n`);
  ctx.stdout.write(`按 Ctrl-C 退出。\n`);
  if (handle.port !== requestedPort) {
    ctx.stdout.write(`提示: 端口 ${requestedPort} 被占用，已自动切换到 ${handle.port}。\n`);
  }
  if (options.openBrowser !== false) openBrowser(url);

  await new Promise<void>((resolve) => {
    const signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
    const onSignal = () => {
      for (const signal of signals) process.removeListener(signal, onSignal);
      resolve();
    };
    for (const signal of signals) process.on(signal, onSignal);
  });

  handle.stop();
  return 0;
}
