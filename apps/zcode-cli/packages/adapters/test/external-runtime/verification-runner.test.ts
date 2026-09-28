import assert from "node:assert/strict";
import test from "node:test";
import {
  redactVerificationLog,
  runExternalRuntimeVerification,
} from "../../src/exec/external-runtime/verification-runner.js";

test("verification logs are redacted and truncated", async () => {
  const evidence = await runExternalRuntimeVerification(
    [
      {
        id: "unit",
        argv: [process.execPath, "-e", "console.log('token=secret-value');console.error('ok')"],
      },
      {
        id: "failing",
        argv: [process.execPath, "-e", "process.exit(3)"],
      },
    ],
    { cwd: process.cwd(), timeoutMs: 10_000, maxLogChars: 64 },
  );
  assert.equal(evidence.status, "failed");
  assert.equal(evidence.commands[0]?.exitCode, 0);
  assert.match(evidence.commands[0]?.stdout ?? "", /token=\[REDACTED\]/);
  assert.equal(evidence.commands[1]?.exitCode, 3);
  assert.equal(redactVerificationLog("Bearer abc123"), "Bearer [REDACTED]");
});

test("empty verification argv is rejected", async () => {
  await assert.rejects(() =>
    runExternalRuntimeVerification([{ id: "bad", argv: [] }], {
      cwd: process.cwd(),
      timeoutMs: 1000,
    }),
  );
});
