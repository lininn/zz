import assert from "node:assert/strict";
import test from "node:test";
import { CodexCliAdapter } from "../../src/exec/external-runtime/codex-adapter.js";
import { OpenCodeCliAdapter } from "../../src/exec/external-runtime/opencode-adapter.js";
import { vendorFixture } from "./vendor-fixture.js";

test("Codex probes the offline vendor binary, strict requirements, and no permission replies", async (t) => {
  const fixture = await vendorFixture(t, "codex", "success");
  const adapter = new CodexCliAdapter({
    processHost: fixture.host,
    outerSandboxReady: true,
    preflightRunner: fixture.runner,
    testedVersion: "0.156.1",
  });
  const report = await adapter.probe({
    runtimeId: adapter.id,
    requiredCapabilities: [
      "structuredOutput",
      "structuredTerminalResult",
      "permissionMode",
      "leafEnforcement",
    ],
  });
  assert.equal(report.available, true);
  assert.equal(report.version, "0.156.1");
  assert.equal(report.authenticated, true);
  assert.equal(report.capabilities.permissionReplies, false);
  const unsupported = await adapter.probe({
    runtimeId: adapter.id,
    requiredCapabilities: ["permissionReplies", "unconfirmedCapability"],
  });
  assert.equal(unsupported.available, false);
  assert.ok(unsupported.warnings.includes("required_capability_missing:permissionReplies"));
  assert.ok(unsupported.warnings.includes("required_capability_missing:unconfirmedCapability"));
  assert.equal(fixture.starts.length, 0);
});

for (const scenario of ["version", "auth", "help", "leaf", "sandbox"] as const) {
  test(`Codex preflight fails closed: ${scenario}`, async (t) => {
    const fixture = await vendorFixture(t, "codex", "success");
    const adapter = new CodexCliAdapter({
      processHost: fixture.host,
      outerSandboxReady: scenario !== "sandbox",
      minimumVersion: "0.156.1",
      preflightRunner: {
        ...fixture.runner,
        run: async (binary, args) => {
          if (
            (scenario === "version" && args.includes("--version")) ||
            (scenario === "auth" && args.includes("login")) ||
            (scenario === "help" && args.includes("--help"))
          ) {
            return { exitCode: 1, stdout: "", stderr: "" };
          }
          if (scenario === "leaf" && args.includes("features"))
            return { exitCode: 0, stdout: "", stderr: "" };
          return fixture.runner.run(binary, args);
        },
      },
    });
    const report = await adapter.probe({ runtimeId: adapter.id, requiredCapabilities: [] });
    assert.equal(report.available, false);
    assert.ok(report.warnings.length > 0);
    assert.equal(fixture.starts.length, 0);
  });
}

test("OpenCode reports JSON stream but unavailable terminal/leaf/permission contracts", async (t) => {
  const fixture = await vendorFixture(t, "opencode", "success");
  const adapter = new OpenCodeCliAdapter({
    processHost: fixture.host,
    outerSandboxReady: true,
    preflightRunner: fixture.runner,
  });
  const report = await adapter.probe({ runtimeId: adapter.id, requiredCapabilities: [] });
  assert.equal(report.authenticated, true);
  assert.equal(report.capabilities.structuredOutput, true);
  assert.equal(report.capabilities.structuredTerminalResult, false);
  assert.equal(report.capabilities.permissionReplies, false);
  assert.equal(report.capabilities.leafEnforcement, false);
  assert.equal(report.available, false);
  assert.ok(report.warnings.includes("structured_terminal_result_missing"));
  assert.ok(report.warnings.includes("leaf_enforcement_incomplete"));
});

test("OpenCode auth list exit 0 with no credentials is not authenticated", async (t) => {
  const fixture = await vendorFixture(t, "opencode", "success");
  const adapter = new OpenCodeCliAdapter({
    processHost: fixture.host,
    outerSandboxReady: true,
    preflightRunner: {
      ...fixture.runner,
      run: (binary, args) =>
        args[0] === "auth"
          ? Promise.resolve({ exitCode: 0, stdout: "0 credentials", stderr: "" })
          : fixture.runner.run(binary, args),
    },
  });
  const report = await adapter.probe({ runtimeId: adapter.id, requiredCapabilities: [] });
  assert.equal(report.authenticated, false);
  assert.ok(report.warnings.includes("authentication_failed"));
});

for (const missingFeature of ["multi_agent", "hooks"] as const) {
  test(`Codex cannot infer ${missingFeature} support from prefixes or removed flags`, async (t) => {
    const fixture = await vendorFixture(t, "codex", "success");
    const adapter = new CodexCliAdapter({
      processHost: fixture.host,
      outerSandboxReady: true,
      preflightRunner: {
        ...fixture.runner,
        run: async (binary, args) => {
          const result = await fixture.runner.run(binary, args);
          return args[0] === "features"
            ? {
                ...result,
                stdout: result.stdout.replace(
                  `${missingFeature} stable`,
                  `${missingFeature} removed`,
                ),
              }
            : result;
        },
      },
    });
    const report = await adapter.probe({ runtimeId: adapter.id, requiredCapabilities: [] });
    assert.equal(report.available, false);
    assert.equal(report.capabilities.leafEnforcement, false);
    assert.equal(report.capabilities.resume, false);
  });
}
