import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = await mkdtemp(resolve(tmpdir(), "crew-fixture-test-"));
try {
  const outfile = resolve(directory, "fixture.test.mjs");
  await build({
    entryPoints: [resolve(root, "specs/agent-crew/e2e/fixture-services.test.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    tsconfig: resolve(root, "packages/ui/tsconfig.json"),
    nodePaths: [resolve(root, "packages/ui/node_modules")],
    logLevel: "warning",
  });
  process.exitCode = await new Promise((resolveCode, reject) => {
    const child = spawn(process.execPath, ["--test", outfile], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolveCode(code ?? 1));
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
