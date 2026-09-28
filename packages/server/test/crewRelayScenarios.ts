import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { WebSocket } from "ws";
import { connectViaWebSocket } from "@zcode/client";
import type { CrewCreateParams } from "@zcode/shared";
import { connectRpc, type crewServices, type Phone } from "./crewRelaySupport.js";

interface RelayFixture {
  directory: string;
  local: ReturnType<typeof crewServices>;
  phone: Phone;
  pc: Server;
  wsOptions?: object;
  stopConnector(): Promise<void>;
  restartConnector(): Promise<void>;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>, label: string, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function observe<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

async function assertClosed(result: ReturnType<typeof observe>, label: string) {
  const settled = await within(result, label);
  assert.equal(settled.ok, false, `${label} unexpectedly succeeded`);
  if (!settled.ok) {
    assert.ok(settled.error instanceof Error);
    assert.equal(settled.error.name, "ConnectionClosed", `${label}: wrong rejection`);
    assert.match(settled.error.message, /WebSocket connection closed/);
  }
}

function browserConnection(t: TestContext, f: RelayFixture) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  const sockets = new Set<WebSocket>();
  // 仅补浏览器构造器/cookie；生命周期与 ChannelClient 销毁必须由生产 client 负责。
  // 旧 connectRpc 的手工 dispose 会掩盖“外层 socket 已关闭但 RPC 永久 pending”的缺陷。
  class BrowserWebSocket extends WebSocket {
    constructor(url: string | URL) {
      super(url, { ...f.wsOptions, headers: { cookie: f.phone.cookie } });
      sockets.add(this);
      this.on("error", () => {});
    }
  }
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: BrowserWebSocket,
  });
  t.after(() => {
    for (const ws of sockets) ws.terminate();
    if (previous) Object.defineProperty(globalThis, "WebSocket", previous);
    else Reflect.deleteProperty(globalThis, "WebSocket");
  });
  return async () => {
    const closed = deferred<{ code: number; reason: string }>();
    const services = await connectViaWebSocket(f.phone.base.replace(/^http/, "ws") + "/ws", {
      onClose: (event) => closed.resolve(event),
    });
    assert.ok(
      services.crewService,
      "crew service must be available through the production accessor",
    );
    return { services, crew: services.crewService, closed: closed.promise };
  };
}

export async function assertDirectoryAndCreateCompatibility(t: TestContext, f: RelayFixture) {
  const directory = join(f.directory, "directory-picker");
  await mkdir(join(directory, "nested"), { recursive: true });
  await mkdir(join(directory, ".hidden"));
  await writeFile(join(directory, "readme.txt"), "fixture");
  const rpc = connectRpc(
    t,
    f.phone.base.replace(/^http/, "ws") + "/ws",
    f.phone.cookie,
    f.wsOptions,
  );
  await rpc.opened;
  assert.deepEqual(await rpc.system.info(), { homedir: homedir(), platform: process.platform });
  const entries = await rpc.file.readdir({ path: directory });
  assert.deepEqual(
    entries.map(({ name, type }) => ({ name, type })),
    [
      { name: "nested", type: "directory" },
      { name: "readme.txt", type: "file" },
    ],
  );
  assert.ok(entries.every((entry) => entry.path === join(directory, entry.name)));
  assert.deepEqual(await rpc.file.readdir({ path: join(directory, "nested") }), []);
  assert.ok(
    (await rpc.file.readdir({ path: directory, includeHidden: true })).some(
      (entry) => entry.name === ".hidden",
    ),
  );
  await assert.rejects(
    within(rpc.file.readdir({ path: join(directory, "missing") }), "missing directory"),
    /ENOENT/,
  );
  await assert.rejects(
    within(rpc.file.readdir({ path: join(directory, "readme.txt") }), "not a directory"),
    /ENOTDIR/,
  );
  assert.equal((await rpc.file.readdir({ path: directory })).length, 2, "read retry stays usable");

  const before = (await rpc.crew.list({})).length;
  const agent = await rpc.catalog.create({
    name: "Compatibility agent",
    systemPrompt: "Test",
    runtime: "zcode",
    accessMode: "read",
  });
  // 历史语义 fixture，不声称拿到了 2026-09-26 09:12 的前端 bundle。
  const cases: CrewCreateParams[] = [
    { name: "Legacy minimal", members: [] },
    { name: "Legacy catalog", members: [{ agentId: agent.agentId }] },
    {
      name: "Legacy relay settings",
      members: [{ agentId: agent.agentId }],
      relayMode: "semi",
      relayAutoHops: 2,
      relayBudgetMinutes: 10,
    },
    {
      name: "Current schema",
      members: [{ memberId: "current-member", agentId: agent.agentId, accessMode: "read" }],
      relayMode: "auto",
      relayAutoHops: 3,
      relayBudgetMinutes: 20,
      relayPaused: true,
    },
  ];
  for (const input of cases) {
    const group = await within(rpc.crew.create(input), input.name);
    assert.equal(group.name, input.name);
    assert.equal(group.members.length, input.members.length);
    group.members.forEach((member, index) => {
      const expected = input.members[index]!;
      assert.equal(member.agentId, expected.agentId);
      if (expected.memberId !== undefined) assert.equal(member.memberId, expected.memberId);
      if (expected.accessMode !== undefined) assert.equal(member.accessMode, expected.accessMode);
    });
    assert.equal(group.relayMode, input.relayMode ?? "manual");
    if (input.relayAutoHops !== undefined) assert.equal(group.relayAutoHops, input.relayAutoHops);
    if (input.relayBudgetMinutes !== undefined)
      assert.equal(group.relayBudgetMinutes, input.relayBudgetMinutes);
    if (input.relayPaused !== undefined) assert.equal(group.relayPaused, input.relayPaused);
    const persisted = (await rpc.crew.list({})).find((item) => item.groupId === group.groupId);
    assert.deepEqual(persisted, group);
    await rpc.crew.delete({ groupId: group.groupId });
  }
  const malformed = [
    { input: { name: "Missing members" }, error: /members/ },
    { input: { name: "", members: [] }, error: /name/ },
    {
      input: { name: "Old embedded role", members: [{ name: "Manager", rolePrompt: "Plan" }] },
      error: /agentId|unrecognized/,
    },
    {
      input: { name: "Unknown field", members: [], schemaVersion: 999 },
      error: /schemaVersion|unrecognized/,
    },
    { input: { name: "Bad mode", members: [], relayMode: "future" }, error: /relayMode/ },
    { input: { name: "Bad hops", members: [], relayAutoHops: 9 }, error: /relayAutoHops/ },
  ];
  for (const { input, error } of malformed) {
    await assert.rejects(
      within(rpc.crew.create(input as CrewCreateParams), "malformed create"),
      error,
    );
  }
  assert.equal((await rpc.crew.list({})).length, before, "malformed payloads never persist");
  await rpc.catalog.delete({ agentId: agent.agentId });
}

export async function assertEstablishedInterruption(t: TestContext, f: RelayFixture) {
  const connect = browserConnection(t, f);
  const rpc = await connect();
  await rpc.services.systemService.info(); // 确认 Initialize 已到达，后面的 RPC 是在途调用。
  const before = (await rpc.crew.list({})).length;
  const release = deferred();
  const created = deferred();
  const fileRead = deferred();
  const systemRead = deferred();
  const httpArrived = deferred();
  t.after(() => release.resolve());
  const create = f.local.crew.create.bind(f.local.crew);
  const readdir = f.local.file.readdir.bind(f.local.file);
  const info = f.local.system.info.bind(f.local.system);
  t.mock.method(f.local.crew, "create", async (input: CrewCreateParams) => {
    const group = await create(input);
    created.resolve();
    await release.promise;
    return group;
  });
  t.mock.method(
    f.local.file,
    "readdir",
    async (input: { path: string; includeHidden?: boolean }) => {
      const entries = await readdir(input);
      fileRead.resolve();
      await release.promise;
      return entries;
    },
  );
  t.mock.method(f.local.system, "info", async () => {
    const value = await info();
    systemRead.resolve();
    await release.promise;
    return value;
  });
  const listeners = f.pc.listeners("request") as Array<
    (req: IncomingMessage, res: ServerResponse) => void
  >;
  for (const listener of listeners) f.pc.removeListener("request", listener);
  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    const forward = () => {
      for (const listener of listeners) listener.call(f.pc, req, res);
    };
    if (req.url?.includes("relay-interruption")) {
      httpArrived.resolve();
      void release.promise.then(() => {
        if (!res.destroyed) forward();
      });
    } else forward();
  };
  f.pc.on("request", onRequest);
  t.after(() => {
    f.pc.removeListener("request", onRequest);
    for (const listener of listeners) f.pc.on("request", listener);
  });
  const pendingCreate = observe(
    rpc.crew.create({ name: "Accepted before disconnect", members: [] }),
  );
  const pendingFile = observe(rpc.services.fileService.readdir({ path: f.directory }));
  const pendingSystem = observe(rpc.services.systemService.info());
  const pendingHttp = observe(f.phone.request("/api/server-info?relay-interruption=1"));
  await within(
    Promise.all([created.promise, fileRead.promise, systemRead.promise, httpArrived.promise]),
    "PC received all requests",
  );
  const start = Date.now();
  await f.stopConnector();
  await Promise.all([
    assertClosed(pendingCreate, "established create"),
    assertClosed(pendingFile, "established readdir"),
    assertClosed(pendingSystem, "established info"),
  ]);
  const http = await within(pendingHttp, "established HTTP");
  assert.ok(http.ok, "relay must return a concrete HTTP failure");
  assert.equal(http.value.status, 502);
  assert.match(await http.value.text(), /断开|中断|设备|离线/);
  const closed = await within(rpc.closed, "relay WS close");
  assert.equal(closed.code, 1013);
  assert.match(closed.reason, /连接中断/);
  assert.ok(Date.now() - start < 2000, "observed close must not wait 10s relay / 25s UI timeouts");
  release.resolve();
  await f.restartConnector();
  const fresh = await connect();
  const groups = await fresh.crew.list({});
  assert.equal(
    groups.length,
    before + 1,
    "accepted create remains committed exactly once; no rollback/replay",
  );
  assert.equal(groups.filter((item) => item.name === "Accepted before disconnect").length, 1);
  await assert.rejects(
    within(rpc.crew.create({ name: "Stale accessor", members: [] }), "stale accessor"),
    /disposed|Canceled|cancelled/i,
  );
  assert.equal((await fresh.crew.list({})).length, before + 1);
  assert.ok((await fresh.services.fileService.readdir({ path: f.directory })).length > 0);
  t.diagnostic(
    `established HTTP502 / WS1013 and 3 production RPC rejections in ${Date.now() - start}ms including reconnect`,
  );
}

export async function assertOpeningInterruption(
  t: TestContext,
  f: RelayFixture & {
    pauseChannelOpens(): void | Promise<void>;
    waitForPendingOpens(count: number): Promise<void>;
  },
) {
  const connect = browserConnection(t, f);
  const before = (await f.local.crew.list({})).length;
  await f.pauseChannelOpens();
  const rpc = await connect(); // 外层 WS open，但 RPC Initialize 尚未到达（memory：relay 数据通道；TCP：本地目标握手）。
  const pendingCreate = observe(rpc.crew.create({ name: "Never admitted", members: [] }));
  const pendingFile = observe(rpc.services.fileService.readdir({ path: f.directory }));
  const pendingSystem = observe(rpc.services.systemService.info());
  const pendingHttp = observe(f.phone.request("/api/server-info"));
  await f.waitForPendingOpens(2);
  assert.equal((await f.local.crew.list({})).length, before);
  const start = Date.now();
  await f.stopConnector();
  await Promise.all([
    assertClosed(pendingCreate, "opening create"),
    assertClosed(pendingFile, "opening readdir"),
    assertClosed(pendingSystem, "opening info"),
  ]);
  const http = await within(pendingHttp, "opening HTTP");
  assert.ok(http.ok);
  assert.equal(http.value.status, 502);
  assert.match(await http.value.text(), /断开|中断|离线|关闭/);
  assert.equal((await within(rpc.closed, "opening WS close")).code, 1013);
  assert.ok(Date.now() - start < 2000, "pending open must abort without the 10s open timeout");
  await f.restartConnector();
  const fresh = await connect();
  await fresh.services.systemService.info();
  assert.equal((await fresh.crew.list({})).length, before, "pre-initialize create must not replay");
  const group = await fresh.crew.create({
    name: "Explicit fresh create",
    members: [],
  });
  assert.equal((await fresh.crew.list({})).length, before + 1);
  await fresh.crew.delete({ groupId: group.groupId });
  t.diagnostic(
    `opening HTTP502 / WS1013 and 3 production RPC rejections in ${Date.now() - start}ms including reconnect`,
  );
}
