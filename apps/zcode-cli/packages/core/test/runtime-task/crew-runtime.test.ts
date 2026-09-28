import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { ExternalRuntimeDispatchService } from "../../src/runtime-task/external-runtime-service.js";
import { deferred, event, fixture, request, terminal } from "./crew-runtime-fixture.js";

async function waitPermission(service: ExternalRuntimeDispatchService) {
  for (let index = 0; index < 100; index++) {
    const task = await service.readTask("crew_ext_1");
    if (task?.permission) return task;
    await setImmediate();
  }
  throw new Error("permission was not projected while process was alive");
}

for (const status of ["succeeded", "failed", "cancelled"] as const) {
  test(`crew structured ${status} preserves terminal state and summary`, async () => {
    const { service } = fixture(async function* (req) {
      yield event(req, 1, "task.started");
      yield terminal(req, 2, status);
    });
    await service.dispatch(request());
    await service.waitForIdle();
    const task = await service.readTask("crew_ext_1");
    assert.equal(task?.runtimeState, status);
    assert.equal(task?.summary, "structured fixture summary");
    assert.equal(task?.nativeSessionId, "native-1");
    assert.equal(task?.settled, true);
  });
}

test("crew permission is live; supported approve resumes the same iterator", async () => {
  const resume = deferred();
  const { service, adapter, starts } = fixture(async function* (req) {
    yield event(req, 1, "task.started");
    yield event(req, 2, "permission.requested", { request_id: "permission-1", tool_name: "Read" });
    await resume.promise;
    yield terminal(req, 3);
  });
  adapter.respondPermission = async (_handle, input) => {
    assert.deepEqual(input, { requestId: "permission-1", approved: true });
    resume.resolve();
  };
  await service.dispatch(request());
  const task = await waitPermission(service);
  assert.equal(task.settled, false);
  assert.equal(task.permission?.canRespond, true);
  await service.respondPermission("crew_ext_1", "permission-1", true);
  await service.waitForIdle();
  assert.equal((await service.readTask("crew_ext_1"))?.runtimeState, "succeeded");
  assert.equal(starts.length, 1);
});

for (const approved of [false, true]) {
  test(`crew ${approved ? "unsupported approve" : "deny"} waits for process stop before settled cancellation`, async () => {
    const cancelled = deferred();
    const stopped = deferred();
    let didStop = false;
    const { service, adapter } = fixture(async function* (req) {
      yield event(req, 1, "task.started");
      yield event(req, 2, "permission.requested", { request_id: "permission-1" });
      await cancelled.promise;
      await stopped.promise;
      didStop = true;
      yield terminal(req, 3, "cancelled");
    });
    adapter.cancel = async () => {
      cancelled.resolve();
    };
    await service.dispatch(request());
    const task = await waitPermission(service);
    assert.equal(task.permission?.canRespond, false);
    let returned = false;
    const response = service.respondPermission("crew_ext_1", "permission-1", approved).then(() => {
      returned = true;
    });
    await cancelled.promise;
    assert.equal(returned, false);
    assert.equal((await service.readTask("crew_ext_1"))?.settled, false);
    stopped.resolve();
    await response;
    assert.equal(didStop, true);
    assert.equal((await service.readTask("crew_ext_1"))?.runtimeState, "cancelled");
    assert.equal((await service.readTask("crew_ext_1"))?.settled, true);
  });
}

test("crew stale permission response cannot approve a newer request", async () => {
  const done = deferred();
  const { service, adapter } = fixture(async function* (req) {
    yield event(req, 1, "task.started");
    yield event(req, 2, "permission.requested", { request_id: "current" });
    await done.promise;
    yield terminal(req, 3, "cancelled");
  });
  adapter.cancel = async () => {
    done.resolve();
  };
  await service.dispatch(request());
  await waitPermission(service);
  await assert.rejects(service.respondPermission("crew_ext_1", "old", true), /stale/);
  await service.cancel("crew_ext_1");
});

test("crew restart fences live permission rather than replaying or claiming safe cancel", async () => {
  const { service, store, options, starts } = fixture(async function* () {
    throw new Error("must not execute");
  });
  store.save({
    version: 1,
    entries: [
      {
        request: request(),
        runtimeState: "awaiting_permission",
        enqueuedAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
        settled: false,
      },
    ],
  });
  const recovered = new ExternalRuntimeDispatchService(options);
  await recovered.recover();
  await recovered.cancel("crew_ext_1");
  assert.equal((await recovered.readTask("crew_ext_1"))?.runtimeState, "recovery_required");
  assert.equal((await recovered.readTask("crew_ext_1"))?.settled, false);
  assert.equal(starts.length, 0);
  void service;
});

test("crew outer sandbox missing refuses preflight and never starts an adapter", async () => {
  const { options, starts } = fixture(async function* () {
    throw new Error("must not execute");
  });
  const service = new ExternalRuntimeDispatchService({ ...options, outerSandboxReady: false });
  assert.equal((await service.probe("claude-cli", "read")).available, false);
  await service.dispatch(request());
  await service.waitForIdle();
  assert.equal((await service.readTask("crew_ext_1"))?.runtimeState, "runtime_unavailable");
  assert.equal((await service.readTask("crew_ext_1"))?.settled, true);
  assert.equal(starts.length, 0);
});

test("crew malformed/cross-attempt envelope fails closed", async () => {
  const { service } = fixture(async function* (req) {
    yield event(req, 1, "task.started");
    yield { ...terminal(req, 2), attemptId: "stale-attempt" };
  });
  await service.dispatch(request());
  await service.waitForIdle();
  assert.equal((await service.readTask("crew_ext_1"))?.runtimeState, "protocol_error");
});

test("crew cancel during adapter startup is retried after task.started", async () => {
  const prepared = deferred();
  const booted = deferred();
  const stop = deferred();
  let ready = false;
  let cancelled = 0;
  const { service, adapter } = fixture(async function* (req) {
    prepared.resolve();
    await booted.promise;
    ready = true;
    yield event(req, 1, "task.started");
    await stop.promise;
    yield terminal(req, 2, "cancelled");
  });
  adapter.cancel = async () => {
    cancelled++;
    if (ready) stop.resolve();
  };
  await service.dispatch(request());
  await prepared.promise;
  const cancellation = service.cancel("crew_ext_1");
  await setImmediate();
  booted.resolve();
  await cancellation;
  assert.ok(cancelled >= 2);
  assert.equal((await service.readTask("crew_ext_1"))?.settled, true);
});

test("crew cancellation cleanup failure cannot become settled cancelled", async () => {
  const ended = deferred();
  const { service, adapter } = fixture(async function* (req) {
    yield event(req, 1, "task.started");
    yield event(req, 2, "permission.requested", { request_id: "p" });
    await ended.promise;
    yield terminal(req, 3, "cancelled");
  });
  adapter.cancel = async () => {
    ended.resolve();
    throw new Error("cannot prove process stopped");
  };
  await service.dispatch(request());
  await waitPermission(service);
  await service.cancel("crew_ext_1");
  const task = await service.readTask("crew_ext_1");
  assert.equal(task?.runtimeState, "recovery_required");
  assert.equal(task?.settled, false);
});

test("crew settled permission stays visible until explicit cancellation clears it", async () => {
  const { service } = fixture(async function* (req) {
    yield event(req, 1, "task.started");
    yield event(req, 2, "permission.requested", { request_id: "permission-1" });
    yield terminal(req, 3);
  });
  await service.dispatch(request());
  await service.waitForIdle();
  const waiting = await service.readTask("crew_ext_1");
  assert.equal(waiting?.runtimeState, "awaiting_permission");
  assert.equal(waiting?.settled, true);
  assert.equal(waiting?.permission?.canRespond, false);
  await service.cancel("crew_ext_1");
  const cancelled = await service.readTask("crew_ext_1");
  assert.equal(cancelled?.runtimeState, "cancelled");
  assert.equal(cancelled?.settled, true);
  assert.equal(cancelled?.permission, undefined);
});

test("crew adapter cleanup failure fences queued work and never claims settled", async () => {
  const { service } = fixture(async function* () {
    throw new Error("recovery_required: process cleanup failed");
  });
  await service.dispatch(request());
  await service.dispatch(request({ taskId: "crew_ext_2", attemptId: "attempt-2" }));
  await service.waitForIdle();
  assert.equal((await service.readTask("crew_ext_1"))?.settled, false);
  assert.equal((await service.readTask("crew_ext_2"))?.runtimeState, "queued");
  await assert.rejects(service.resume(), /recovery_required/);
});

test("crew permission remains visible when vendor exits with failed result", async () => {
  const { service } = fixture(async function* (req) {
    yield event(req, 1, "task.started");
    yield event(req, 2, "permission.requested", { request_id: "permission-1" });
    yield terminal(req, 3, "failed");
  });
  await service.dispatch(request());
  await service.waitForIdle();
  assert.equal((await service.readTask("crew_ext_1"))?.runtimeState, "awaiting_permission");
  assert.equal((await service.readTask("crew_ext_1"))?.settled, true);
  await service.cancel("crew_ext_1");
  assert.equal((await service.readTask("crew_ext_1"))?.permission, undefined);
});

test("crew missing required capabilities are unavailable even if vendor probe says available", async () => {
  const { service, adapter, starts } = fixture(async function* () {
    throw new Error("must not execute");
  });
  const probe = adapter.probe.bind(adapter);
  adapter.probe = async (context) => ({ ...(await probe(context)), capabilities: {} });
  assert.equal((await service.probe("claude-cli", "write")).available, false);
  await service.dispatch(request());
  await service.waitForIdle();
  assert.equal((await service.readTask("crew_ext_1"))?.runtimeState, "runtime_unavailable");
  assert.equal(starts.length, 0);
});
