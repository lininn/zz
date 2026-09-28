import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { TestContext } from "node:test";
import { createHttpServer } from "../src/http.js";
import {
  blogResponse,
  crewServices,
  deviceId,
  Phone,
  relayRoot,
  testToken,
  testUser,
  until,
} from "./crewRelaySupport.js";

interface RelayProcessFixture {
  directory: string;
  local: ReturnType<typeof crewServices>;
  phone: Phone;
  pc: Server;
  stopConnector(): Promise<void>;
  restartConnector(): Promise<void>;
  pauseChannelOpens(): void;
  waitForPendingOpens(count: number): Promise<void>;
  addDevice(): Promise<string>;
}

export async function relayProcessFixture(
  t: TestContext,
  authToken?: string,
): Promise<RelayProcessFixture | null> {
  const directory = await mkdtemp(join(tmpdir(), "crew-relay-tcp-"));
  const cleanup: Array<() => unknown | Promise<unknown>> = [
    () => rm(directory, { recursive: true, force: true }),
  ];
  t.after(async () => {
    for (const dispose of cleanup.reverse()) await dispose();
  });
  const ownServer = (server: Server) => {
    const sockets = new Set<import("node:net").Socket>();
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    cleanup.push(async () => {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    return server;
  };
  const blog = ownServer(
    createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const data = blogResponse(req.url!, JSON.parse(Buffer.concat(chunks).toString()));
        res.writeHead(data.status ? 200 : 401, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      } catch {
        res.writeHead(400);
        res.end();
      }
    }),
  );
  const listening = once(blog, "listening");
  blog.listen(0, "127.0.0.1");
  try {
    await listening;
  } catch (error) {
    if (
      ["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "") &&
      process.env.ZCODE_REQUIRE_NETWORK_E2E !== "1"
    ) {
      t.skip(
        `TCP E2E unavailable: ${(error as Error).message}; no socket/process evidence claimed`,
      );
      return null;
    }
    throw error;
  }
  await access(join(relayRoot, "src/server/index.js"));
  const portOf = (server: Server) => (server.address() as { port: number }).port;
  const local = crewServices(directory);
  cleanup.push(() => local.close());
  const pc = ownServer(
    createHttpServer(local.collection, 0, {
      host: "127.0.0.1",
      ...(authToken ? { authToken } : {}),
    }) as Server,
  );
  await once(pc, "listening");
  const env = {
    ...process.env,
    HOME: directory,
    ZCODE_DATA_BASE_DIR: directory,
    PORT: "0",
    RELAY_DATA_DIR: join(directory, "relay"),
    SESSION_SECRET: "test-only-session-secret",
    PAIR_TOKEN: "test-only-pair",
    COOKIE_SECURE: "0",
    BLOG_API_URL: `http://127.0.0.1:${portOf(blog)}`,
    WEB_STATIC_DIR: join(directory, "web"),
    LOCAL_ADMIN_PORT: "0",
    LOCAL_TARGET: `http://127.0.0.1:${portOf(pc)}`,
    ZCODE_RELAY_CREDENTIALS_FILE: join(directory, "credentials.json"),
    ZCODE_RELAY_DEVICE_NAME: "Isolated crew test PC",
  };
  await mkdir(env.WEB_STATIC_DIR);
  await writeFile(
    join(env.WEB_STATIC_DIR, "index.html"),
    "<!doctype html><title>Isolated test</title>",
  );
  await writeFile(
    env.ZCODE_RELAY_CREDENTIALS_FILE,
    JSON.stringify({ username: testUser, accessToken: testToken, deviceId }),
    { mode: 0o600 },
  );
  function launch(entry: string, childEnv: NodeJS.ProcessEnv) {
    const child = spawn(process.execPath, [join(relayRoot, entry)], {
      cwd: directory,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    let error: Error | undefined;
    child.stdout.on("data", (bytes) => {
      log = (log + String(bytes)).slice(-16000);
    });
    child.stderr.on("data", (bytes) => {
      log = (log + String(bytes)).slice(-16000);
    });
    child.on("error", (value) => {
      error = value;
    });
    const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
    cleanup.push(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        const timeout = delay(3000, false, { ref: false });
        if (!(await Promise.race([exited.then(() => true), timeout]))) child.kill("SIGKILL");
      }
      await exited;
    });
    return {
      async stop() {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await exited;
      },
      async wait(pattern: RegExp) {
        await until(
          () => {
            if (error) throw error;
            if (child.exitCode !== null || child.signalCode !== null)
              throw new Error(`${entry} exited before ready:\n${log}`);
            return pattern.test(log);
          },
          `${entry} readiness`,
          15000,
        );
        return log.match(pattern)!;
      },
    };
  }
  const relay = launch("src/server/index.js", env);
  const [, port] = await relay.wait(/listening on :(\d+)/);
  const base = `http://127.0.0.1:${port}`;
  const connectorEnv = { ...env, RELAY_URL: base.replace(/^http/, "ws") };
  let connector = launch("src/connector/index.js", connectorEnv);
  await connector.wait(/绑定成功/);
  let pendingOpens = 0;
  let resumeTarget = () => {};
  cleanup.push(() => resumeTarget());
  return {
    directory,
    local,
    phone: new Phone(base),
    pc,
    stopConnector: () => connector.stop(),
    async restartConnector() {
      resumeTarget();
      connector = launch("src/connector/index.js", connectorEnv);
      await connector.wait(/绑定成功/);
    },
    pauseChannelOpens() {
      pendingOpens = 0;
      const restore: Array<() => void> = [];
      // 保留真实 TCP/connector 子进程；仅在目标端暂停 HTTP 响应与 WS upgrade，
      // 覆盖本地握手未完成、Initialize 尚未返回时的中断；relay pending-open 另由内存 seam 覆盖。
      for (const event of ["request", "upgrade"] as const) {
        const listeners = pc.listeners(event);
        for (const listener of listeners) pc.removeListener(event, listener);
        const hold = () => {
          pendingOpens++;
        };
        pc.on(event, hold);
        restore.push(() => {
          pc.removeListener(event, hold);
          for (const listener of listeners) pc.on(event, listener);
        });
      }
      resumeTarget = () => {
        for (const resume of restore.splice(0)) resume();
      };
    },
    async waitForPendingOpens(count: number) {
      await until(() => pendingOpens >= count, "target HTTP / WS setup pending");
    },
    async addDevice() {
      const secondId = "bda34e12-813b-4448-a7be-f8d3e7b7c529";
      const credentials = join(directory, "second-credentials.json");
      await writeFile(
        credentials,
        JSON.stringify({ username: testUser, accessToken: testToken, deviceId: secondId }),
        { mode: 0o600 },
      );
      const second = launch("src/connector/index.js", {
        ...env,
        RELAY_URL: base.replace(/^http/, "ws"),
        ZCODE_RELAY_CREDENTIALS_FILE: credentials,
        ZCODE_RELAY_DEVICE_NAME: "Second isolated PC",
      });
      await second.wait(/绑定成功/);
      return secondId;
    },
  };
}
