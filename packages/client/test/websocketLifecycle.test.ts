import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  ChannelServer,
  Emitter,
  Event as RpcEvent,
  ProxyChannel,
  SocketProtocol,
  VSBuffer,
} from "@zcode/rpc";
import { ICrewService, IFileService, ISystemService } from "@zcode/services";
import { connectViaWebSocket } from "../src/websocket.js";

class BrowserSocket extends EventTarget {
  static readonly OPEN = 1;
  static latest: BrowserSocket;
  readyState = 0;
  binaryType = "blob";
  readonly sent: Uint8Array[] = [];
  readonly data = new Emitter<VSBuffer>();
  constructor(readonly url: string) {
    super();
    BrowserSocket.latest = this;
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  send(bytes: Uint8Array) {
    this.sent.push(bytes);
    this.data.fire(VSBuffer.wrap(bytes));
  }
  receive(bytes: Uint8Array) {
    this.dispatchEvent(new MessageEvent("message", { data: Uint8Array.from(bytes).buffer }));
  }
  close(code = 1013, reason = "Device disconnected") {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code, reason, wasClean: true }));
  }
  fail() {
    this.dispatchEvent(new Event("error"));
  }
}

function fixture(t: TestContext) {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = BrowserSocket as unknown as typeof WebSocket;
  t.after(() => {
    globalThis.WebSocket = original;
  });
  return {
    async connect(initialize = true) {
      const promise = connectViaWebSocket("ws://relay.example.test/ws");
      const ws = BrowserSocket.latest;
      const protocol = new SocketProtocol({
        onData: ws.data.event,
        onClose: RpcEvent.None,
        onEnd: RpcEvent.None,
        write: (bytes) => ws.receive(bytes.buffer),
        end() {},
        drain: async () => {},
        dispose() {},
      });
      const server = new ChannelServer(protocol, "browser-test", 1000, true);
      t.after(() => {
        server.dispose();
        protocol.dispose();
        ws.close();
        ws.data.dispose();
      });
      ws.open();
      const services = await promise;
      if (initialize) server.ready();
      return { ws, server, services };
    },
  };
}

async function rejectsQuickly(promise: Promise<unknown>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await assert.rejects(
      Promise.race([
        promise,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("RPC stayed pending")), 150);
        }),
      ]),
      /ConnectionClosed|dispos|disconnect|closed|failed/i,
    );
  } finally {
    clearTimeout(timeout);
  }
}

for (const terminal of ["close", "error"] as const) {
  for (const initialize of [false, true]) {
    test(`production browser client rejects ${initialize ? "in-flight" : "pre-Initialize"} directory/create RPC on ${terminal}`, async (t) => {
      const { ws, server, services } = await fixture(t).connect(initialize);
      let admitted = 0;
      server.registerChannel(
        ISystemService.channelName,
        ProxyChannel.fromService({ info: () => new Promise(() => {}) }),
      );
      server.registerChannel(
        IFileService.channelName,
        ProxyChannel.fromService({ readdir: () => new Promise(() => {}) }),
      );
      server.registerChannel(
        ICrewService.channelName,
        ProxyChannel.fromService({
          create: () => {
            admitted++;
            return new Promise(() => {});
          },
        }),
      );
      const info = services.systemService.info();
      const files = services.fileService.readdir({ path: "/fixture" });
      const create = services.crewService!.create({
        name: "Fixture",
        members: [{ agentId: "fixture" }],
      });
      await Promise.resolve();
      const checks = [info, files, create].map(rejectsQuickly);
      if (terminal === "close") ws.close();
      else ws.fail();
      await Promise.all(checks);
      assert.equal(admitted, initialize ? 1 : 0);
      const sent = ws.sent.length;
      server.ready();
      await rejectsQuickly(
        services.crewService!.create({ name: "No replay", members: [{ agentId: "fixture" }] }),
      );
      assert.equal(
        ws.sent.length,
        sent,
        "closed client never sends or replays calls on later Initialize",
      );
    });
  }
}

test("production browser connection rejects failed opening and reports close metadata", async (t) => {
  fixture(t);
  const events: unknown[] = [];
  const connecting = connectViaWebSocket("ws://relay.example.test/ws", {
    onClose: (event) => events.push(event),
  });
  const check = rejectsQuickly(connecting);
  BrowserSocket.latest.close(4401, "Authentication required");
  await check;
  assert.deepEqual(events, [{ code: 4401, reason: "Authentication required", wasClean: true }]);
});

test("new browser connection succeeds without replaying previous failed create", async (t) => {
  const f = fixture(t);
  const first = await f.connect();
  first.server.registerChannel(
    ICrewService.channelName,
    ProxyChannel.fromService({ create: () => new Promise(() => {}) }),
  );
  const pending = rejectsQuickly(
    first.services.crewService!.create({ name: "Old draft", members: [{ agentId: "fixture" }] }),
  );
  first.ws.close();
  await pending;
  const next = await f.connect();
  let creates = 0;
  next.server.registerChannel(
    ICrewService.channelName,
    ProxyChannel.fromService({
      create: async () => {
        creates++;
        return { groupId: "new" };
      },
    }),
  );
  next.server.registerChannel(
    ISystemService.channelName,
    ProxyChannel.fromService({ info: async () => ({ homedir: "/home/fixture" }) }),
  );
  next.server.registerChannel(
    IFileService.channelName,
    ProxyChannel.fromService({
      readdir: async () => [{ name: "project", path: "/home/fixture/project", type: "directory" }],
    }),
  );
  assert.equal((await next.services.systemService.info()).homedir, "/home/fixture");
  assert.equal(
    (await next.services.fileService.readdir({ path: "/home/fixture" }))[0]?.name,
    "project",
  );
  assert.equal(
    (
      await next.services.crewService!.create({
        name: "New draft",
        members: [{ agentId: "fixture" }],
      })
    ).groupId,
    "new",
  );
  assert.equal(creates, 1);
});

test("socket asynchronously closed by onOpenSocket cannot resolve a dead accessor", async (t) => {
  fixture(t);
  const connecting = connectViaWebSocket("ws://relay.example.test/ws", {
    onOpenSocket: (socket) => socket.close(),
  });
  const ws = BrowserSocket.latest;
  t.mock.method(ws, "close", () => {
    if (ws.readyState >= 2) return;
    // 浏览器 close() 先进入 CLOSING，close 事件在之后的任务才派发。
    ws.readyState = 2;
    setTimeout(() => {
      ws.readyState = 3;
      ws.dispatchEvent(
        Object.assign(new Event("close"), {
          code: 1000,
          reason: "",
          wasClean: true,
        }),
      );
    }, 0);
  });
  const check = rejectsQuickly(connecting);
  ws.open();
  await check;
});

test("error before open rejects connection and ignores a late open event", async (t) => {
  fixture(t);
  let opened = 0;
  const connecting = connectViaWebSocket("ws://relay.example.test/ws", {
    onOpenSocket: () => opened++,
  });
  const check = rejectsQuickly(connecting);
  BrowserSocket.latest.fail();
  BrowserSocket.latest.open();
  await check;
  assert.equal(opened, 0);
});
