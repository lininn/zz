import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import { ExternalRuntimeResultSchema } from "@zcode/contracts";
import { CodexCliAdapter } from "../../src/exec/external-runtime/codex-adapter.js";
import { OpenCodeCliAdapter } from "../../src/exec/external-runtime/opencode-adapter.js";
import { vendorFixture, vendorRequest, collectEvents } from "./vendor-fixture.js";

for (const [vendor, Adapter] of [
  ["codex", CodexCliAdapter],
  ["opencode", OpenCodeCliAdapter],
] as const) {
  test(`${vendor}: unstructured output settles with text summary`, async (t) => {
    // vendor 不保证遵守 "Return only JSON"；adapter 负责整合内容——turn 正常终止
    // 且进程 exit 0 时，用最后一条文本作为 summary 收口，不得因非 JSON 打回。
    const fixture = await vendorFixture(t, vendor, "unstructured");
    const adapter = new Adapter({ processHost: fixture.host, outerSandboxReady: true });
    const events = await collectEvents(adapter.start(vendorRequest(vendor, fixture.cwd)));
    const terminal = events.find((event) => event.type === "task.completed");
    assert.ok(terminal);
    assert.equal(terminal.payload.status, "succeeded");
    assert.equal(terminal.payload.summary, "plain text");
  });

  test(`${vendor}: delegation fails closed`, async (t) => {
    const fixture = await vendorFixture(t, vendor, "delegation");
    const adapter = new Adapter({ processHost: fixture.host, outerSandboxReady: true });
    await assert.rejects(
      collectEvents(adapter.start(vendorRequest(vendor, fixture.cwd))),
      /policy_violation/,
    );
  });

  test(`${vendor}: split stdout survives independently framed stderr`, async (t) => {
    const fixture = await vendorFixture(t, vendor, "split");
    const adapter = new Adapter({ processHost: fixture.host, outerSandboxReady: true });
    const events = await collectEvents(adapter.start(vendorRequest(vendor, fixture.cwd)));
    const warnings = events.filter((event) => event.type === "warning");
    assert.ok(
      warnings.some(
        (event) => (event.payload as { nativeType: string }).nativeType === "vendor.future_event",
      ),
    );
    assert.equal(
      warnings.some(
        (event) => (event.payload as { nativeType: string }).nativeType === "malformed",
      ),
      false,
    );
    assert.equal(ExternalRuntimeResultSchema.parse(events.at(-1)?.payload).status, "succeeded");
  });

  test(`${vendor}: unsafe resume and missing outer sandbox never spawn`, async (t) => {
    const fixture = await vendorFixture(t, vendor, "success");
    const adapter = new Adapter({ processHost: fixture.host, outerSandboxReady: true });
    await assert.rejects(
      collectEvents(
        adapter.start(vendorRequest(vendor, fixture.cwd, { resumeNativeSessionId: "--last" })),
      ),
      /resume session id/,
    );
    const unsandboxed = new Adapter({ processHost: fixture.host, outerSandboxReady: false });
    await assert.rejects(
      collectEvents(unsandboxed.start(vendorRequest(vendor, fixture.cwd))),
      /outer sandbox/,
    );
    assert.equal(fixture.starts.length, 0);
  });

  for (const failure of ["cancel", "completed"] as const) {
    test(`${vendor}: cleanup ${failure} failure requires recovery and retains task guard`, async (t) => {
      const fixture = await vendorFixture(t, vendor, "hang");
      const adapter = new Adapter({
        outerSandboxReady: true,
        processHost: {
          start: async (options) => {
            const handle = await fixture.host.start(options);
            const completed =
              failure === "completed"
                ? handle.completed.then(() => {
                    throw new Error("exit confirmation failed");
                  })
                : handle.completed;
            // 真实子进程先退出；测试延后 await 时仍须避免 Node 将故意拒绝报成 unhandled rejection。
            void completed.catch(() => {});
            return {
              ...handle,
              completed,
              cancel: async () => {
                await handle.cancel();
                if (failure === "cancel") throw new Error("cancellation failed");
              },
            };
          },
        },
      });
      const request = vendorRequest(vendor, fixture.cwd);
      const iterator = adapter.start(request)[Symbol.asyncIterator]();
      await iterator.next();
      await assert.rejects(iterator.return!(), /^Error: recovery_required:/);
      await assert.rejects(
        collectEvents(adapter.start({ ...request, attemptId: "attempt-2" })),
        /already running/,
      );
      assert.equal(fixture.starts.length, 1);
    });
  }

  test(`${vendor}: consumer early return terminates process and permits new attempt`, async (t) => {
    const fixture = await vendorFixture(t, vendor, "hang");
    const adapter = new Adapter({ processHost: fixture.host, outerSandboxReady: true });
    const request = vendorRequest(vendor, fixture.cwd);
    const iterator = adapter.start(request)[Symbol.asyncIterator]();
    await iterator.next();
    await assert.rejects(collectEvents(adapter.start(request)), /already running/);
    await iterator.return?.();
    assert.ok(fixture.signals.includes("SIGTERM"));
    const next = adapter.start({ ...request, attemptId: "attempt-2" })[Symbol.asyncIterator]();
    await next.next();
    await next.return?.();
    assert.equal(fixture.starts.length, 2);
  });
}

test("Codex does not force a JSON output schema by default", async (t) => {
  // 强制 --output-schema 会让写不出 JSON 的弱模型整段丢产出，是历史反复断链的根因。
  // 默认必须不带该参数，让明文 summary 走明文兜底；交接由 @成员名/标签承担。
  const fixture = await vendorFixture(t, "codex", "success");
  const adapter = new CodexCliAdapter({ processHost: fixture.host, outerSandboxReady: true });
  await collectEvents(adapter.start(vendorRequest("codex", fixture.cwd)));
  const args = fixture.starts[0]!.command.args!;
  assert.equal(args.includes("--output-schema"), false);
  assert.equal(args.includes("--approve-for-me"), false);
  // 0.157 的 exec 子命令无 --ask-for-approval（顶层传该参数会 argv 解析失败 exit 2）；
  // --ignore-user-config 会丢弃用户自定义 model provider，两者都必须缺席。
  assert.equal(args.includes("--ask-for-approval"), false);
  assert.equal(args.includes("--ignore-user-config"), false);
  assert.equal(args[0], "exec");
  assert.equal(args.includes("--json"), true);
  assert.equal(args.includes("--skip-git-repo-check"), true);
});

test("Codex caller-supplied schema uses a temp file and cleans it up", async (t) => {
  const fixture = await vendorFixture(t, "codex", "success");
  const adapter = new CodexCliAdapter({
    processHost: fixture.host,
    outerSandboxReady: true,
    outputSchema: { type: "object", required: ["summary"] },
  });
  await collectEvents(adapter.start(vendorRequest("codex", fixture.cwd)));
  const args = fixture.starts[0]!.command.args!;
  const schemaIndex = args.indexOf("--output-schema");
  assert.notEqual(schemaIndex, -1);
  const schema = args[schemaIndex + 1]!;
  await assert.rejects(access(schema), { code: "ENOENT" });
});

test("OpenCode never silently drops a caller's output schema", async (t) => {
  const fixture = await vendorFixture(t, "opencode", "success");
  const adapter = new OpenCodeCliAdapter({
    processHost: fixture.host,
    outerSandboxReady: true,
    outputSchema: {},
  });
  await assert.rejects(
    collectEvents(adapter.start(vendorRequest("opencode", fixture.cwd))),
    /no verified output schema flag/,
  );
  assert.equal(fixture.starts.length, 0);
});
