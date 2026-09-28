import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { ClaudeCliAdapter } from "../../src/exec/external-runtime/claude-adapter.js";
import { ExternalRuntimeProcessHost } from "../../src/exec/external-runtime/process-host.js";
import { vendorRequest, collectEvents } from "./vendor-fixture.js";

const binary = fileURLToPath(new URL("./fixtures/crew-claude-binary.mjs", import.meta.url));
function fixture(t: TestContext, scenario: string) {
  const children: ReturnType<typeof spawn>[] = [];
  t.after(() => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  });
  const processHost = new ExternalRuntimeProcessHost({
    spawn: (_file, _args, options) => {
      const child = spawn(process.execPath, [binary, scenario], {
        cwd: options.cwd,
        env: options.env,
        stdio: "pipe",
      });
      children.push(child);
      return child;
    },
    killProcess: (pid, signal) => {
      try {
        process.kill(pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    },
  });
  const adapter = new ClaudeCliAdapter({
    outerSandboxReady: true,
    processHost: {
      start: (options) =>
        processHost.start({
          ...options,
          supervisor: { ...options.supervisor, interruptGraceMs: 20, terminateGraceMs: 20 },
        }),
    },
  });
  return { adapter, children, request: vendorRequest("claude", process.cwd()) };
}
for (const scenario of ["success", "malformed"])
  test(`Claude fake binary ${scenario}`, async (t) => {
    const f = fixture(t, scenario);
    const events = await collectEvents(f.adapter.start(f.request));
    assert.equal((events.at(-1)!.payload as { status: string }).status, "succeeded");
    if (scenario === "malformed")
      assert.equal(events.filter((event) => event.type === "warning").length, 2);
  });
test("Claude stderr cannot forge structured final output", async (t) => {
  const f = fixture(t, "stderr-terminal");
  await assert.rejects(collectEvents(f.adapter.start(f.request)), /protocol_error/);
});
test("Claude successful JSON cannot hide a nonzero process exit", async (t) => {
  const f = fixture(t, "exit-failure");
  await assert.rejects(collectEvents(f.adapter.start(f.request)), /protocol_error/);
});
test("Claude policy rejection stops still-running vendor before reporting failure", async (t) => {
  const f = fixture(t, "policy");
  await assert.rejects(collectEvents(f.adapter.start(f.request)), /policy_violation/);
  assert(f.children[0]);
  assert(f.children[0].exitCode !== null || f.children[0].signalCode !== null);
});
for (const scenario of ["permission", "hang"])
  test(`Claude ${scenario} cancellation produces safe structured terminal`, async (t) => {
    const f = fixture(t, scenario);
    const iterator = f.adapter.start(f.request)[Symbol.asyncIterator]();
    let event = await iterator.next();
    while (
      !event.done &&
      event.value.type !==
        (scenario === "permission" ? "permission.requested" : "task.state_changed")
    )
      event = await iterator.next();
    assert.equal(event.done, false);
    await f.adapter.cancel(f.request);
    const rest = await collectEvents({ [Symbol.asyncIterator]: () => iterator });
    assert.equal((rest.at(-1)!.payload as { status: string }).status, "cancelled");
    assert(f.children[0]);
    assert(f.children[0].exitCode !== null || f.children[0].signalCode !== null);
  });
test("Claude launches with probed leaf denial and read-only tool surface, not permissive defaults", async (t) => {
  const f = fixture(t, "success");
  let args: readonly string[] = [];
  const adapter = new ClaudeCliAdapter({
    outerSandboxReady: true,
    processHost: {
      start: async (options) => {
        args = options.command.args ?? [];
        return new ExternalRuntimeProcessHost({
          spawn: (_file, _args, spawnOptions) => {
            const child = spawn(process.execPath, [binary, "success"], {
              cwd: spawnOptions.cwd,
              env: spawnOptions.env,
              stdio: "pipe",
            });
            f.children.push(child);
            return child;
          },
        }).start(options);
      },
    },
  });
  await collectEvents(adapter.start({ ...f.request, accessMode: "read" }));
  assert(args.includes("--disable-slash-commands"));
  assert.match(args[args.indexOf("--disallowedTools") + 1]!, /Agent.*Task/);
  assert.equal(args[args.indexOf("--permission-mode") + 1], "manual");
  assert.equal(args[args.indexOf("--tools") + 1], "Read,Glob,Grep");
});

test("Claude vendor error cannot be elevated by a contradictory structured success", async (t) => {
  const f = fixture(t, "native-failure");
  const events = await collectEvents(f.adapter.start(f.request));
  assert.equal((events.at(-1)!.payload as { status: string }).status, "failed");
});
