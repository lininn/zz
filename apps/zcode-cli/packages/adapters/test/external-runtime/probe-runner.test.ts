import assert from "node:assert/strict";
import test from "node:test";
import { createSystemProbeRunner } from "../../src/exec/external-runtime/probe-runner.js";

test("finds real binaries on PATH and misses absent ones", async () => {
  const runner = createSystemProbeRunner();
  assert.ok(await runner.findBinary("node"));
  assert.equal(await runner.findBinary("definitely-not-a-real-binary-xyz"), undefined);
});

test("probe runs report exit codes without shells", async () => {
  const runner = createSystemProbeRunner();
  const node = await runner.findBinary("node");
  assert.ok(node);
  const version = await runner.run(node, ["--version"]);
  assert.equal(version.exitCode, 0);
  assert.match(version.stdout, /v\d+\.\d+\.\d+/);
  const failing = await runner.run(node, ["-e", "process.exit(3)"]);
  assert.equal(failing.exitCode, 1);
});
