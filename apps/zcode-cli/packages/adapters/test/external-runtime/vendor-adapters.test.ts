import assert from "node:assert/strict";
import test from "node:test";
import { ExternalRuntimeResultSchema } from "@zcode/contracts";
import { CodexCliAdapter } from "../../src/exec/external-runtime/codex-adapter.js";
import { OpenCodeCliAdapter } from "../../src/exec/external-runtime/opencode-adapter.js";
import { validateExternalRuntimeEventSequence } from "@zcode/contracts";
import { vendorFixture, vendorRequest, collectEvents } from "./vendor-fixture.js";

for (const [vendor, Adapter] of [
  ["codex", CodexCliAdapter],
  ["opencode", OpenCodeCliAdapter],
] as const) {
  test(`${vendor}: fake binary structured success, model and explicit resume`, async (t) => {
    const fixture = await vendorFixture(t, vendor, "success");
    const adapter = new Adapter({
      processHost: fixture.host,
      outerSandboxReady: true,
      defaultModel: "test-model",
    });
    const events = await collectEvents(
      adapter.start(
        vendorRequest(vendor, fixture.cwd, { resumeNativeSessionId: "native-session-1" }),
      ),
    );
    validateExternalRuntimeEventSequence(events);
    assert.equal(ExternalRuntimeResultSchema.parse(events.at(-1)?.payload).status, "succeeded");
    assert.equal(events.at(-1)?.nativeSessionId, "native-session-1");
    assert.ok(fixture.starts[0]?.command.args?.includes("native-session-1"));
    assert.ok(fixture.starts[0]?.command.args?.includes("test-model"));
  });

  test(`${vendor}: malformed/unknown lines and stderr stay warnings`, async (t) => {
    const fixture = await vendorFixture(t, vendor, "malformed");
    const adapter = new Adapter({ processHost: fixture.host, outerSandboxReady: true });
    const events = await collectEvents(adapter.start(vendorRequest(vendor, fixture.cwd)));
    validateExternalRuntimeEventSequence(events);
    assert.ok(events.filter((event) => event.type === "warning").length >= 3);
  });

  test(`${vendor}: permission remains observable and cannot silently succeed`, async (t) => {
    const fixture = await vendorFixture(t, vendor, "permission");
    const adapter = new Adapter({ processHost: fixture.host, outerSandboxReady: true });
    const events = await collectEvents(adapter.start(vendorRequest(vendor, fixture.cwd)));
    assert.ok(events.some((event) => event.type === "permission.requested"));
    assert.equal(ExternalRuntimeResultSchema.parse(events.at(-1)?.payload).status, "failed");
    assert.equal("replyPermission" in adapter, false);
  });

  for (const method of ["cancel", "interrupt"] as const) {
    test(`${vendor}: ${method} terminates fake binary without terminal JSON`, async (t) => {
      const fixture = await vendorFixture(t, vendor, "hang");
      const adapter = new Adapter({ processHost: fixture.host, outerSandboxReady: true });
      const request = vendorRequest(vendor, fixture.cwd);
      const iterator = adapter.start(request)[Symbol.asyncIterator]();
      const first = await iterator.next();
      assert.equal(first.value?.type, "task.started");
      await adapter[method]({
        taskId: request.taskId,
        attemptId: "stale-attempt",
        runtimeId: request.runtimeId,
      });
      assert.equal(fixture.signals.length, 0);
      await adapter[method]({
        taskId: request.taskId,
        attemptId: request.attemptId,
        runtimeId: request.runtimeId,
      });
      const rest = await collectEvents({ [Symbol.asyncIterator]: () => iterator });
      assert.equal(ExternalRuntimeResultSchema.parse(rest.at(-1)?.payload).status, "cancelled");
    });
  }

  test(`${vendor}: exit failure overrides a plausible successful result`, async (t) => {
    const fixture = await vendorFixture(t, vendor, "exit-failure");
    const adapter = new Adapter({ processHost: fixture.host, outerSandboxReady: true });
    const events = await collectEvents(adapter.start(vendorRequest(vendor, fixture.cwd)));
    assert.equal(ExternalRuntimeResultSchema.parse(events.at(-1)?.payload).status, "failed");
  });

  test(`${vendor}: missing structured final is protocol_error`, async (t) => {
    const fixture = await vendorFixture(t, vendor, "missing-final");
    const adapter = new Adapter({ processHost: fixture.host, outerSandboxReady: true });
    await assert.rejects(
      collectEvents(adapter.start(vendorRequest(vendor, fixture.cwd))),
      /protocol_error/,
    );
  });

  test(`${vendor}: restart requires caller-supplied resume and preserves native id`, async (t) => {
    const fixture = await vendorFixture(t, vendor, "success");
    const first = new Adapter({ processHost: fixture.host, outerSandboxReady: true });
    const events = await collectEvents(first.start(vendorRequest(vendor, fixture.cwd)));
    const restarted = new Adapter({ processHost: fixture.host, outerSandboxReady: true });
    assert.equal(fixture.starts.length, 1);
    await collectEvents(
      restarted.start(
        vendorRequest(vendor, fixture.cwd, {
          attemptId: "attempt-2",
          resumeNativeSessionId: events.at(-1)?.nativeSessionId,
        }),
      ),
    );
    assert.equal(fixture.starts.length, 2);
    assert.ok(fixture.starts[1]?.command.args?.includes("native-session-1"));
  });

  test(`${vendor}: unsafe configured args do not start a binary`, async (t) => {
    const fixture = await vendorFixture(t, vendor, "success");
    const adapter = new Adapter({
      processHost: fixture.host,
      outerSandboxReady: true,
      configuredArgs: ["--auto"],
    });
    await assert.rejects(
      collectEvents(adapter.start(vendorRequest(vendor, fixture.cwd))),
      /configured argument/,
    );
    assert.equal(fixture.starts.length, 0);
  });

  test(`${vendor}: missing binary and required capability fail closed`, async (t) => {
    const fixture = await vendorFixture(t, vendor, "success");
    const adapter = new Adapter({
      processHost: fixture.host,
      outerSandboxReady: true,
      preflightRunner: {
        findBinary: async () => undefined,
        run: async () => {
          throw new Error("must not run");
        },
      },
    });
    const report = await adapter.probe({
      runtimeId: `${vendor}-cli`,
      requiredCapabilities: ["permissionReplies"],
    });
    assert.equal(report.available, false);
    assert.equal(report.capabilities.permissionReplies, false);
    assert.ok(report.warnings.includes("binary_not_found"));
    assert.equal(fixture.starts.length, 0);
  });
}
