import assert from "node:assert/strict";
import test from "node:test";
import { createCrewExternalRuntime } from "../src/crew/crewExternalRuntime.js";
import { externalCrewFixture } from "./crewExternalRuntimeFixture.js";

for (const missing of ["bridge", "method"] as const) {
  test(`preflight reports ${missing} unavailability without claiming binary failure or starting tasks`, async () => {
    const f = await externalCrewFixture();
    try {
      if (missing === "bridge") delete f.f.agent.crewRuntime;
      else
        f.f.agent.crewRuntime = async () => {
          throw Object.assign(new Error("Method not found: crew/runtime"), { code: -32601 });
        };
      const detail = await f.service.get({ groupId: f.group.groupId });
      const runtime = createCrewExternalRuntime({
        agent: f.f.agent,
        leases: f.leases,
        preflight: f.runtime.preflight,
        start: async () => {
          throw new Error("probe must not start");
        },
        prompt: () => {
          throw new Error("probe must not create prompt");
        },
      });
      // 详情投影的 cached 探测首轮返回 null 并在后台刷新；这里直接走准入路径验证探测结果。
      const probe = await runtime.probeMember(
        detail.group.workspaceBinding!,
        detail.resolvedMembers[0]!,
      );
      assert.equal(probe?.available, false);
      assert.match(probe?.reason ?? "", /crew\/runtime.*unavailable/);
      assert.equal(f.calls.length, 0);
      assert.equal(detail.executions.length, 0);
    } finally {
      await f.close();
    }
  });
}

test("preflight hides unknown exception details and preserves genuine runtime verdicts", async () => {
  const f = await externalCrewFixture();
  try {
    const detail = await f.service.get({ groupId: f.group.groupId });
    const binding = detail.group.workspaceBinding!;
    const member = detail.resolvedMembers[0]!;
    // 不使用 cached 投影，直接验证准入路径对真实探测结果的处理。
    const probe = () => f.runtime.probeMember!(binding, member);
    const original = f.f.agent.crewRuntime!;
    f.f.agent.crewRuntime = async () => {
      throw new Error("private process diagnostic");
    };
    const failed = await probe();
    assert.equal(failed?.reason, "crew.runtimeUnavailable");
    f.f.agent.crewRuntime = original;
    f.available(false);
    const unavailable = await probe();
    assert.equal(unavailable?.reason, "binary_not_found");
    assert.equal(unavailable?.available, false);
    f.available(true);
    assert.equal((await probe())?.available, true);
    assert.ok(f.calls.every((command) => command.action === "probe"));
    assert.equal(f.tasks.size, 0);
  } finally {
    await f.close();
  }
});
