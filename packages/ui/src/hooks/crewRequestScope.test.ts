import assert from "node:assert/strict";
import test from "node:test";
import { createCrewRequestScope, runCrewCommand } from "./crewRequestScope.js";
import { crewErrorKey } from "../crew/crewErrors.js";
import en from "../i18n/locales/en-US.js";
import zh from "../i18n/locales/zh-CN.js";

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

test("foreground deadline restores pending at 25s and ignores late create success without replay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const scope = createCrewRequestScope();
  const deferred = Promise.withResolvers<string>();
  let writes = 0,
    refreshes = 0,
    notifications = 0;
  const first = runCrewCommand(
    scope,
    () => true,
    () => {
      writes++;
      return deferred.promise;
    },
    async () => {
      refreshes++;
    },
    () => {
      notifications++;
    },
  );
  t.mock.timers.tick(24_999);
  await flush();
  assert.equal(scope.pending, true);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(scope.pending, false);
  const result = await first;
  assert.equal(result.ok, false);
  assert.equal(scope.error, "commandTimeout");
  assert.equal(writes, 1);
  const next = Promise.withResolvers<string>();
  const second = runCrewCommand(
    scope,
    () => true,
    () => next.promise,
    async () => {},
    () => {},
  );
  deferred.resolve("late-created-id");
  await flush();
  assert.equal(scope.pending, true);
  assert.equal(scope.error, null);
  assert.equal(refreshes, 1);
  assert.equal(notifications, 2);
  next.resolve("manually-confirmed-retry");
  assert.equal((await second).ok, true);
});

test("settled commands clear deadlines; late rejected requests and abandoned scopes stay inert", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const clear = t.mock.method(globalThis, "clearTimeout");
  const scope = createCrewRequestScope();
  assert.equal(
    (
      await runCrewCommand(
        scope,
        () => true,
        async () => "ok",
        async () => {},
        () => {},
      )
    ).ok,
    true,
  );
  assert.equal(clear.mock.callCount(), 1);
  const late = Promise.withResolvers<void>();
  let current = true,
    notified = 0;
  const pending = runCrewCommand(
    scope,
    () => current,
    () => late.promise,
    async () => {},
    () => {
      notified++;
    },
  );
  current = false;
  t.mock.timers.tick(25_000);
  await flush();
  assert.equal(scope.pending, false);
  assert.equal((await pending).ok, false);
  assert.equal(notified, 1);
  late.reject(new Error("late-rejection"));
  await flush();
  assert.equal(scope.error, "commandTimeout");
  assert.equal(clear.mock.callCount(), 2);
});

for (const [error, key] of [
  [Object.assign(new Error("transport ended"), { name: "ConnectionClosed" }), "connectionClosed"],
  [new Error("ChannelClient is disposed"), "connectionClosed"],
  [new Error("Unauthorized (401)"), "authentication"],
  [new Error("EACCES: permission denied"), "accessDenied"],
  [new Error("ECONNREFUSED"), "connectionUnavailable"],
  [new Error("crew.groupBusy"), "error.groupBusy"],
] as const) {
  test(`crew errors distinguish ${key}: ${error.message}`, async () => {
    assert.equal(crewErrorKey(error), key);
    const scope = createCrewRequestScope();
    const result = await runCrewCommand(
      scope,
      () => true,
      async () => {
        throw error;
      },
      async () => {},
      () => {},
    );
    assert.equal(result.ok, false);
    assert.equal(scope.pending, false);
    assert.equal(scope.error, key);
  });
}

test("uncertain command copy requires checking group list and closed accessors require reconnect in both locales", () => {
  for (const messages of [en, zh]) {
    const copy = messages as Record<string, string>;
    for (const key of ["commandTimeout", "connectionClosed", "connectionUnavailable"]) {
      assert.match(copy[`crew.${key}`]!, /group list|群组列表/);
    }
    assert.match(copy["crew.connectionClosed"]!, /refresh.*reconnect|刷新.*重新连接/i);
    assert.match(copy["directoryBrowser.errorClosed"]!, /refresh.*reconnect|刷新.*重新连接/i);
  }
});
