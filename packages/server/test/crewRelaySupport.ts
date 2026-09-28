import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import type { TestContext } from "node:test";
import { WebSocket } from "ws";
import { ChannelClient, Emitter, ProxyChannel, SocketProtocol, VSBuffer } from "@zcode/rpc";
import {
  ICrewAgentCatalogService,
  ICrewService,
  IFileService,
  ISystemService,
  ServiceCollection,
} from "@zcode/services";
import { createFileService, createSystemService } from "@zcode/services/node";
import { CrewAgentCatalogService } from "../../services/src/crew/agentCatalogService.js";
import { CrewService } from "../../services/src/crew/crewService.js";
import { CrewStore } from "../../services/src/crew/crewStore.js";
import { join, resolve } from "node:path";

export const relayRoot = resolve(
  process.env.ZCODE_RELAY_ROOT || join(import.meta.dirname, "../../../..", "zcode-relay"),
);
export const testUser = "crew-e2e-user";
export const testToken = "crew-e2e-blog-token";
export const deviceId = "d7807e43-08fc-4aa6-9180-4ca58c23b289";

export async function until(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeout = 10000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await delay(20);
  }
  throw new Error(`Timed out: ${label}`);
}

export function crewServices(directory: string) {
  let probeDelayMs = 0;
  const executions: string[] = [];
  const databasePath = join(directory, "tasks.sqlite");
  const catalog = new CrewAgentCatalogService(databasePath);
  const crew = new CrewService({
    databasePath,
    ownerId: "crew-relay-test-owner",
    isOwnerAlive: () => true,
    runtime: {
      preflight: async () => {},
      probeMember: async () => {
        const ms = probeDelayMs;
        probeDelayMs = 0;
        if (ms) await delay(ms);
        return null;
      },
      cancel: async () => {},
      execute: async ({ execution, onTaskCreated }) => {
        const taskId = `agent_crew_${execution.executionId}`;
        await onTaskCreated(taskId);
        executions.push(execution.executionId);
        return { taskId, text: "Deterministic runtime reply", status: "succeeded" };
      },
    },
  });
  const file = createFileService();
  const system = createSystemService();
  const collection = new ServiceCollection()
    .register(IFileService, file)
    .register(ISystemService, system)
    .register(ICrewService, crew)
    .register(ICrewAgentCatalogService, catalog);
  return {
    collection,
    file,
    system,
    crew,
    databasePath,
    executions,
    delayNextProbe(ms: number) {
      probeDelayMs = ms;
    },
    async close() {
      await crew.dispose();
      await catalog.dispose();
    },
  };
}

export function connectRpc(t: TestContext, url: string, cookie: string, options = {}) {
  const ws = new WebSocket(url, {
    ...options,
    headers: { cookie, origin: "https://phone.example.test" },
  });
  const onData = new Emitter<VSBuffer>();
  const onClose = new Emitter<void>();
  const onEnd = new Emitter<void>();
  const protocol = new SocketProtocol({
    onData: onData.event,
    onClose: onClose.event,
    onEnd: onEnd.event,
    write: (buffer) => ws.send(buffer.buffer),
    end: () => ws.close(),
    drain: async () => {},
    dispose: () => ws.terminate(),
  });
  const client = new ChannelClient(protocol);
  // 外层 open 不代表 PC 握手成功；从构造时接收 Initialize，关闭立即拒绝挂起 RPC。
  ws.on("message", (bytes, binary) => {
    assert.equal(binary, true, "Channel RPC must remain binary through both tunnels");
    onData.fire(VSBuffer.wrap(new Uint8Array(bytes as Buffer)));
  });
  const close = () => {
    client.dispose();
    onClose.fire();
    onEnd.fire();
  };
  ws.on("close", close);
  ws.on("error", close);
  const opened = once(ws, "open").then(() => undefined);
  // 调用者也许先等另一个 RPC；避免握手拒绝在此期间成为未处理 rejection。
  void opened.catch(() => {});
  t.after(() => {
    client.dispose();
    protocol.dispose();
    ws.terminate();
    onData.dispose();
    onClose.dispose();
    onEnd.dispose();
  });
  return {
    ws,
    opened,
    file: ProxyChannel.toService<IFileService>(client.getChannel(IFileService.channelName)),
    system: ProxyChannel.toService<ISystemService>(client.getChannel(ISystemService.channelName)),
    crew: ProxyChannel.toService<ICrewService>(client.getChannel(ICrewService.channelName)),
    catalog: ProxyChannel.toService<ICrewAgentCatalogService>(
      client.getChannel(ICrewAgentCatalogService.channelName),
    ),
  };
}

export class Phone {
  readonly cookies = new Map<string, string>();
  constructor(
    readonly base: string,
    readonly fetcher: typeof fetch = fetch,
  ) {}
  get cookie() {
    return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ");
  }
  async request(path: string, options: RequestInit = {}) {
    const response = await this.fetcher(`${this.base}${path}`, {
      ...options,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      headers: { cookie: this.cookie, ...options.headers },
    });
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";", 1)[0]!;
      const index = pair.indexOf("=");
      const name = pair.slice(0, index),
        value = pair.slice(index + 1);
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    return response;
  }
  async login() {
    const result = await this.request("/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: testUser, password: "test-password" }),
    });
    assert.equal(result.status, 200, await result.text());
    assert.ok(this.cookies.has("relay_session"));
    assert.equal(this.cookies.has("relay_device"), false);
  }
  async select(id = deviceId) {
    const result = await this.request("/relay/select", {
      method: "POST",
      headers: { "content-type": "application/json", origin: this.base },
      body: JSON.stringify({ deviceId: id }),
    });
    assert.equal(result.status, 200, await result.text());
    assert.equal(this.cookies.get("relay_device"), id);
  }
}

export function blogResponse(
  path: string,
  body: { username?: string; password?: string; accessToken?: string },
) {
  const valid =
    path === "/api/relay/auth"
      ? body.username === testUser && body.password === "test-password"
      : path === "/api/relay/verify" && body.accessToken === testToken;
  return valid
    ? {
        status: true,
        user: { username: testUser, displayName: "Crew test" },
        accessToken: testToken,
      }
    : { status: false };
}

export async function assertCrewRoundTrip(
  t: TestContext,
  phone: Phone,
  local: ReturnType<typeof crewServices>,
  directory: string,
  wsOptions = {},
) {
  const rpc = connectRpc(t, phone.base.replace(/^http/, "ws") + "/ws", phone.cookie, wsOptions);
  await rpc.opened;
  const agent = await rpc.catalog.create({
    name: "Project manager",
    systemPrompt: "Plan the test task",
    runtime: "zcode",
    accessMode: "read",
  });
  const group = await rpc.crew.create({
    name: "Relay team",
    members: [{ agentId: agent.agentId }],
  });
  await rpc.crew.bind({
    groupId: group.groupId,
    binding: { workspacePath: directory, workspaceIdentity: "relay-e2e-workspace" },
  });
  local.delayNextProbe(3200);
  const started = Date.now();
  const initial = await rpc.crew.get({ groupId: group.groupId });
  assert.ok(Date.now() - started >= 3000, "the real get call must survive a >3s preflight");
  const text = "派工🧪".repeat(12000); // 48000 UTF-16 units / 120000 UTF-8 bytes，超过旧 64KB body 假设。
  const input = {
    groupId: group.groupId,
    conversationId: initial.conversation.conversationId,
    messageId: "relay-message",
    text,
    mentions: [group.members[0]!.memberId],
  };
  await rpc.crew.send(input);
  await until(
    async () =>
      (await rpc.crew.get({ groupId: group.groupId })).executions[0]?.status === "succeeded",
    "persisted execution succeeds",
  );
  const view = await rpc.crew.get({ groupId: group.groupId });
  assert.equal(view.messages.find((message) => message.messageId === input.messageId)?.text, text);
  assert.equal(view.executions.length, 1);
  assert.equal(view.executions[0]?.workspaceBinding.workspaceIdentity, "relay-e2e-workspace");
  assert.match(view.executions[0]!.taskId!, /^agent_crew_/);
  const store = new CrewStore(local.databasePath);
  try {
    await store.initialize();
    const saved = store.execution(view.executions[0]!.executionId);
    assert.equal(saved.status, "succeeded");
    assert.equal(saved.messageId, input.messageId);
    const row = store.db
      .prepare("SELECT text FROM agent_crew_messages WHERE message_id=? AND group_id=?")
      .get(input.messageId, group.groupId) as { text: string };
    assert.equal(row.text, text);
  } finally {
    store.close();
  }
  const closed = once(rpc.ws, "close");
  rpc.ws.close();
  await closed;
  const reconnected = connectRpc(
    t,
    phone.base.replace(/^http/, "ws") + "/ws",
    phone.cookie,
    wsOptions,
  );
  await reconnected.opened;
  await reconnected.crew.send(input);
  await local.crew.whenIdle();
  assert.equal((await reconnected.crew.get({ groupId: group.groupId })).executions.length, 1);
  assert.equal(local.executions.length, 1, "reconnect/retry must not rerun the accepted message");
}
