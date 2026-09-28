import assert from "node:assert/strict";
import test from "node:test";
import { assertCrewRoundTrip, connectRpc, until } from "./crewRelaySupport.js";
import { relayMemoryFixture } from "./crewRelayMemoryFixture.js";
import {
  assertDirectoryAndCreateCompatibility,
  assertEstablishedInterruption,
  assertOpeningInterruption,
} from "./crewRelayScenarios.js";

// 补充证据：真实 HTTP parser / WS framing / relay / connector / RPC，不等同 TCP 子进程 E2E。
test(
  "in-memory wire relay integration (supplemental, not TCP E2E)",
  { timeout: 45000 },
  async (t) => {
    const f = await relayMemoryFixture(t);
    const { phone, local, directory, wsOptions, sockets, upgradeCookies } = f;
    const legacy = connectRpc(t, "ws://relay.test/ws", phone.cookie, wsOptions);
    sockets.add(legacy.ws);
    await legacy.opened;
    assert.deepEqual(await legacy.crew.list({}), []);
    legacy.ws.close();
    phone.cookies.set("relay_device", "stale-device");
    assert.equal((await phone.request("/api/server-info")).status, 502);
    await phone.select();
    const largeBody = await phone.request("/api/connect-remote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ invalid: "大".repeat(100000) }),
    });
    assert.equal(largeBody.status, 400);
    assert.match(await largeBody.text(), /Invalid request body/);
    await assertCrewRoundTrip(t, phone, local, directory, wsOptions);
    f.protectPc();
    assert.equal((await phone.request("/api/server-info")).status, 401);
    const denied = connectRpc(t, "ws://relay.test/ws", phone.cookie, wsOptions);
    sockets.add(denied.ws);
    await denied.opened;
    await assert.rejects(denied.crew.list({}));
    assert.equal(upgradeCookies.at(-1), "", "relay auth cookies must never reach PC");
    assert.equal((await phone.request("/api/server-info?token=memory-pc-token")).status, 200);
    assert.equal(phone.cookies.get("zcode_lite_token"), "memory-pc-token");
    // HTTP 已成功取得应用 cookie；默认 /ws 不附 query token，应继承同一个应用登录态。
    const authenticated = connectRpc(t, "ws://relay.test/ws", phone.cookie, wsOptions);
    sockets.add(authenticated.ws);
    await authenticated.opened;
    await until(() => upgradeCookies.length === 2, "authenticated PC upgrade arrives");
    assert.equal(
      upgradeCookies.at(-1),
      "zcode_lite_token=memory-pc-token",
      "application cookie lost between relay upgrade and PC upgrade",
    );
    const groups = await authenticated.crew.list({});
    assert.equal(groups.length, 1);
    const group = groups[0]!;
    await authenticated.crew.send({
      groupId: group.groupId,
      messageId: "authenticated-send",
      text: "Assign via authenticated relay",
      mentions: [group.members[0]!.memberId],
    });
    await until(
      async () =>
        (await authenticated.crew.get({ groupId: group.groupId })).executions.length === 2 &&
        local.executions.length === 2,
      "authenticated send reaches CrewService",
    );
    await local.crew.whenIdle();
    assert.equal(
      (await authenticated.crew.get({ groupId: group.groupId })).executions.every(
        (item) => item.status === "succeeded",
      ),
      true,
    );
    await t.test(
      "real system.info/file.readdir and historical/current create schemas",
      async (t) => {
        await assertDirectoryAndCreateCompatibility(t, f);
      },
    );
    await t.test(
      "established HTTP + production browser RPC fast-fail and never replay",
      async (t) => {
        await assertEstablishedInterruption(t, f);
      },
    );
    await t.test("opening HTTP + production browser RPC fast-fail and never replay", async (t) => {
      await assertOpeningInterruption(t, f);
    });
  },
);
