import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { TestContext } from "node:test";
import { WebSocket } from "ws";
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

interface RelayMemoryFixture {
  directory: string;
  local: ReturnType<typeof crewServices>;
  phone: Phone;
  wsOptions: object;
  upgradeCookies: string[];
  sockets: Set<WebSocket>;
  pc: http.Server;
  protectPc(): void;
  stopConnector(): Promise<void>;
  restartConnector(): Promise<void>;
  pauseChannelOpens(): void;
  waitForPendingOpens(count: number): Promise<void>;
}

// 真实 HTTP parser / WS framing / relay / connector；仅替换 TCP，不是子进程 E2E。
export async function relayMemoryFixture(t: TestContext): Promise<RelayMemoryFixture> {
  const directory = await mkdtemp(join(tmpdir(), "crew-relay-memory-"));
  const local = crewServices(directory);
  const sockets = new Set<WebSocket>();
  const rawSockets = new Set<import("node:net").Socket>();
  const originalEnv = { ...process.env };
  let connector: { stop(): void } | undefined;
  let pauseOpens = false;
  let pendingOpens = 0;
  // 未 listen 的 HTTP server 不持有活跃 handle；限时 test 的等待由此 handle 保活。
  const keepAlive = setInterval(() => {}, 1000);
  t.after(async () => {
    connector?.stop();
    for (const ws of sockets) ws.terminate();
    for (const socket of rawSockets) socket.destroy();
    t.mock.restoreAll();
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    clearInterval(keepAlive);
    await local.close();
    await rm(directory, { recursive: true, force: true });
  });
  Object.assign(process.env, {
    PAIR_TOKEN: "memory-test-pair",
    SESSION_SECRET: "memory-test-secret",
    COOKIE_SECURE: "0",
    RELAY_DATA_DIR: join(directory, "relay"),
    BLOG_API_URL: "http://blog.test",
    RELAY_URL: "ws://relay.test",
    LOCAL_TARGET: "http://127.0.0.1:3030",
    ZCODE_RELAY_CREDENTIALS_FILE: join(directory, "credentials.json"),
    ZCODE_RELAY_DEVICE_NAME: "Memory test PC",
    WEB_STATIC_DIR: join(directory, "no-static"),
  });
  await writeFile(
    process.env.ZCODE_RELAY_CREDENTIALS_FILE!,
    JSON.stringify({ deviceId, username: testUser, accessToken: testToken }),
    { mode: 0o600 },
  );
  const load = (file: string) => import(pathToFileURL(join(relayRoot, file)).href);
  const { connectionTo, fetchFrom } = await load("tests/memory-transport.js");
  // 只替换 TCP listen，保留 ZCode 的真实 HTTP app、鉴权和 WebSocket 路由。
  const listenMock = t.mock.method(http.Server.prototype, "listen", function (this: http.Server) {
    return this;
  });
  const createPc = (token?: string) => {
    const server = createHttpServer(
      local.collection,
      0,
      token ? { authToken: token } : {},
    ) as http.Server;
    server.on("connection", (socket) => {
      rawSockets.add(socket);
      socket.on("close", () => rawSockets.delete(socket));
    });
    return server;
  };
  const openPc = createPc();
  const protectedPc = createPc("memory-pc-token");
  listenMock.mock.restore();
  let pc = openPc;
  const stalled = http.createServer();
  stalled.on("connection", (socket) => rawSockets.add(socket));
  stalled.on("upgrade", () => {}); // 保持真实数据通道握手 pending，直到控制连接中断。
  const upgradeCookies: string[] = [];
  protectedPc.on("upgrade", (req) => upgradeCookies.push(req.headers.cookie || ""));
  const { server: relay } = await load("src/server/index.js");
  relay.on("connection", (socket: import("node:net").Socket) => {
    rawSockets.add(socket);
    socket.on("close", () => rawSockets.delete(socket));
  });
  const request = http.request;
  // 与 relay 既有测试相同的 stream seam；所有网络目的地白名单化，不能意外访问真实服务。
  t.mock.method(http, "request", function (input: any, options: any, callback: any) {
    const hostname =
      typeof input === "string" || input instanceof URL
        ? new URL(input).hostname
        : input.hostname || input.host;
    let target = hostname === "127.0.0.1" ? pc : hostname === "relay.test" ? relay : null;
    const path =
      typeof input === "object" && !(input instanceof URL) ? input.path : new URL(input).pathname;
    if (hostname === "relay.test" && path?.startsWith("/connector-data") && pauseOpens) {
      pendingOpens++;
      target = stalled;
    }
    if (!target) throw new Error(`Unexpected test HTTP destination: ${hostname}`);
    if (typeof input === "object" && !(input instanceof URL))
      return request({ ...input, createConnection: () => connectionTo(target) }, options);
    return request(input, { ...options, createConnection: () => connectionTo(target) }, callback);
  });
  t.mock.method(globalThis, "fetch", async (input: string | URL, options: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "blog.test");
    return Response.json(blogResponse(url.pathname, JSON.parse(String(options.body))));
  });
  const { createConnector } = await load("src/connector/index.js");
  const runtime = createConnector({
    createWebSocket(url: string, options: object) {
      const ws = new WebSocket(url, { ...options, createConnection: () => connectionTo(relay) });
      sockets.add(ws);
      ws.on("error", () => {});
      return ws;
    },
    logger: { log() {}, error() {} },
    reconnectWait: () => 20,
  });
  connector = runtime;
  runtime.start();
  await until(() => runtime.isBound(), "connector blog verify and bind");
  const phone = new Phone("http://relay.test", ((url: string, options: RequestInit) =>
    fetchFrom(relay, url, {
      ...options,
      headers: { ...options.headers, host: "relay.test" },
    })) as typeof fetch);
  await phone.login();
  const wsOptions = { createConnection: () => connectionTo(relay) };
  return {
    directory,
    local,
    phone,
    wsOptions,
    upgradeCookies,
    sockets,
    get pc() {
      return pc;
    },
    protectPc() {
      pc = protectedPc;
    },
    async stopConnector() {
      runtime.stop();
      await until(() => !runtime.isBound(), "connector closed");
    },
    async restartConnector() {
      pauseOpens = false;
      runtime.start();
      await until(() => runtime.isBound(), "replacement connector bound");
    },
    pauseChannelOpens() {
      pauseOpens = true;
      pendingOpens = 0;
    },
    async waitForPendingOpens(count: number) {
      await until(() => pendingOpens >= count, "real connector data handshakes pending");
    },
  };
}
