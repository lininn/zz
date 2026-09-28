import assert from "node:assert/strict";
import test from "node:test";
import {
  ExternalRuntimeRegistry,
  runExternalRuntimePreflight,
  type ProbeCommandRunner,
} from "../../src/exec/external-runtime/preflight.js";

function runner(handlers: Record<string, { exitCode: number; stdout: string; stderr: string }>): ProbeCommandRunner {
  return {
    findBinary: async () => "/bin/fake-runtime",
    run: async (_command, args) => {
      const response = handlers[args.join(" ")];
      if (!response) throw new Error(`unexpected probe: ${args.join(" ")}`);
      return response;
    },
  };
}

function registry() {
  return new ExternalRuntimeRegistry([
    {
      id: "fake-cli",
      kind: "external",
      binary: "fake-runtime",
      minimumVersion: "1.2.0",
      testedVersion: "1.2.0",
      testedRange: "1.2.0",
      versionProbeArgs: ["--version"],
      helpProbeArgs: [["--help"]],
      authProbeArgs: ["auth", "status"],
      capabilityProbes: [
        { args: ["--help"], capability: "structuredOutput", includesAny: [["--output-format"]] },
        { args: ["--help"], capability: "structuredTerminalResult", includesAny: [["--json-schema"]] },
        { args: ["--help"], capability: "permissionMode", includesAny: [["--permission-mode"]] },
      ],
      leafProfileProbes: [{ args: ["--help"], includesAll: ["--disable-subagents"] }],
    },
  ]);
}

const help = "--output-format --json-schema --permission-mode --disable-subagents";

test("ready preflight reports version, capabilities, and binary", async () => {
  const report = await runExternalRuntimePreflight({
    runtimeId: "fake-cli",
    access: "write",
    runner: runner({
      "--version": { exitCode: 0, stdout: "fake-runtime 1.2.0", stderr: "" },
      "--help": { exitCode: 0, stdout: help, stderr: "" },
      "auth status": { exitCode: 0, stdout: "ok", stderr: "" },
    }),
    outerIsolation: true,
    leafEnforcement: {
      toolAndFeatureDeny: true,
      commandDeny: true,
      eventMonitoring: true,
      resourceLimits: true,
    },
    registry: registry(),
  });
  assert.equal(report.status, "ready");
  assert.equal(report.version, "1.2.0");
  assert.equal(report.binaryPath, "/bin/fake-runtime");
  assert.equal(report.capabilities.structuredOutput, true);
  assert.equal(report.autoContinue, true);
});

test("missing binary and failed auth fail closed", async () => {
  const missing = await runExternalRuntimePreflight({
    runtimeId: "fake-cli",
    access: "read",
    runner: { findBinary: async () => undefined, run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
    outerIsolation: true,
    leafEnforcement: {
      toolAndFeatureDeny: true,
      commandDeny: true,
      eventMonitoring: true,
      resourceLimits: true,
    },
    registry: registry(),
  });
  assert.equal(missing.status, "unavailable");
  assert.ok(missing.failures.includes("binary_not_found"));

  const unauthenticated = await runExternalRuntimePreflight({
    runtimeId: "fake-cli",
    access: "read",
    runner: runner({
      "--version": { exitCode: 0, stdout: "fake-runtime 1.2.0", stderr: "" },
      "--help": { exitCode: 0, stdout: help, stderr: "" },
      "auth status": { exitCode: 1, stdout: "", stderr: "login required" },
    }),
    outerIsolation: true,
    leafEnforcement: {
      toolAndFeatureDeny: true,
      commandDeny: true,
      eventMonitoring: true,
      resourceLimits: true,
    },
    registry: registry(),
  });
  assert.equal(unauthenticated.status, "unauthenticated");
  assert.ok(unauthenticated.failures.includes("authentication_failed"));
});

test("newer than tested versions run with a warning, older versions are rejected", async () => {
  const newerRegistry = new ExternalRuntimeRegistry([
    {
      id: "fake-cli",
      kind: "external",
      binary: "fake-runtime",
      minimumVersion: "1.2.0",
      testedVersion: "1.2.0",
      versionProbeArgs: ["--version"],
      helpProbeArgs: [["--help"]],
      authProbeArgs: ["auth", "status"],
      capabilityProbes: [
        { args: ["--help"], capability: "structuredOutput", includesAny: [["--output-format"]] },
        { args: ["--help"], capability: "structuredTerminalResult", includesAny: [["--json-schema"]] },
        { args: ["--help"], capability: "permissionMode", includesAny: [["--permission-mode"]] },
      ],
      leafProfileProbes: [{ args: ["--help"], includesAll: ["--disable-subagents"] }],
    },
  ]);
  const newer = await runExternalRuntimePreflight({
    runtimeId: "fake-cli",
    access: "read",
    runner: runner({
      "--version": { exitCode: 0, stdout: "fake-runtime 1.4.0", stderr: "" },
      "--help": { exitCode: 0, stdout: help, stderr: "" },
      "auth status": { exitCode: 0, stdout: "ok", stderr: "" },
    }),
    outerIsolation: true,
    leafEnforcement: {
      toolAndFeatureDeny: true,
      commandDeny: true,
      eventMonitoring: true,
      resourceLimits: true,
    },
    registry: newerRegistry,
  });
  assert.equal(newer.status, "ready_with_warning");
  assert.equal(newer.versionPolicy, "newer_untested");

  const older = await runExternalRuntimePreflight({
    runtimeId: "fake-cli",
    access: "read",
    runner: runner({
      "--version": { exitCode: 0, stdout: "fake-runtime 1.1.9", stderr: "" },
      "--help": { exitCode: 0, stdout: help, stderr: "" },
      "auth status": { exitCode: 0, stdout: "ok", stderr: "" },
    }),
    outerIsolation: true,
    leafEnforcement: {
      toolAndFeatureDeny: true,
      commandDeny: true,
      eventMonitoring: true,
      resourceLimits: true,
    },
    registry: newerRegistry,
  });
  assert.equal(older.status, "unavailable");
  assert.ok(older.failures.includes("unsupported_version"));
});

test("write tasks require permission mode and outer isolation", async () => {
  const report = await runExternalRuntimePreflight({
    runtimeId: "fake-cli",
    access: "write",
    runner: runner({
      "--version": { exitCode: 0, stdout: "fake-runtime 1.2.0", stderr: "" },
      "--help": { exitCode: 0, stdout: "--output-format --json-schema --disable-subagents", stderr: "" },
      "auth status": { exitCode: 0, stdout: "ok", stderr: "" },
    }),
    outerIsolation: false,
    leafEnforcement: {
      toolAndFeatureDeny: true,
      commandDeny: true,
      eventMonitoring: true,
      resourceLimits: true,
    },
    registry: registry(),
  });
  assert.equal(report.status, "unavailable");
  assert.ok(report.failures.includes("permission_mode_missing"));
  assert.ok(report.failures.includes("outer_isolation_missing"));
});
