import assert from "node:assert/strict";
import test from "node:test";
import { assertCrewRoundTrip, connectRpc, deviceId } from "./crewRelaySupport.js";
import {
  assertDirectoryAndCreateCompatibility,
  assertEstablishedInterruption,
  assertOpeningInterruption,
} from "./crewRelayScenarios.js";
import { relayProcessFixture } from "./crewRelayProcessFixture.js";

for (const protectedTarget of [false, true]) {
  test(
    `real relay + connector subprocesses -> ZCode crew RPC (${protectedTarget ? "cookie auth" : "no target auth"})`,
    { timeout: 45000 },
    async (t) => {
      const f = await relayProcessFixture(t, protectedTarget ? "isolated-pc-token" : undefined);
      if (!f) return;
      const { phone, local, directory } = f;
      assert.equal((await phone.request("/api/server-info")).status, 401);
      await phone.login();
      const listed = await (await phone.request("/relay/api/devices")).json();
      assert.ok(
        listed.devices.some(
          (item: { deviceId: string; online: boolean }) =>
            item.deviceId === deviceId && item.online,
        ),
      );
      if (protectedTarget) {
        assert.equal((await phone.request("/api/server-info")).status, 401);
        const denied = connectRpc(t, phone.base.replace(/^http/, "ws") + "/ws", phone.cookie);
        await denied.opened;
        await assert.rejects(denied.crew.list({}));
        assert.equal((await phone.request("/api/server-info?token=isolated-pc-token")).status, 200);
        assert.ok(phone.cookies.has("zcode_lite_token"));
      } else {
        // 旧登录没有设备 cookie，唯一在线设备自动路由 HTTP 和 WS。
        const legacy = connectRpc(t, phone.base.replace(/^http/, "ws") + "/ws", phone.cookie);
        await legacy.opened;
        assert.deepEqual(await legacy.crew.list({}), []);
        legacy.ws.close();
        assert.equal((await phone.request("/api/server-info")).status, 200);
        assert.equal(phone.cookies.get("relay_device"), deviceId);
      }
      await f.addDevice();
      phone.cookies.delete("relay_device");
      assert.equal((await phone.request("/api/server-info")).status, 409);
      const ambiguous = connectRpc(t, phone.base.replace(/^http/, "ws") + "/ws", phone.cookie);
      await assert.rejects(ambiguous.opened, /409/);
      phone.cookies.set("relay_device", "stale-device");
      assert.equal((await phone.request("/api/server-info")).status, 502);
      await phone.select();
      // JSON 必须完整穿透，而不是被登录解析器消费；无效业务请求不会连接外部目标。
      const body = await phone.request("/api/connect-remote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invalid: "大".repeat(100000) }),
      });
      assert.equal(body.status, 400);
      assert.match(await body.text(), /Invalid request body/);
      await assertCrewRoundTrip(t, phone, local, directory);
      await t.test("real system/file services and create semantic compatibility", (t) =>
        assertDirectoryAndCreateCompatibility(t, f),
      );
      await t.test(
        "established connector interruption rejects production browser RPC without replay",
        (t) => assertEstablishedInterruption(t, f),
      );
      await t.test(
        "target HTTP / WS setup interruption rejects pre-initialize RPC without replay",
        (t) => assertOpeningInterruption(t, f),
      );
    },
  );
}
