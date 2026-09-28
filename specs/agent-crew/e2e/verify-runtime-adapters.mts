// Real adapter probe only. This is not Web/browser end-to-end verification.
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = await realpath(await mkdtemp(join(tmpdir(), "crew-adapter-probe-")));
const home = join(directory, "home");
const workspace = join(directory, "workspace");
await mkdir(home);
await mkdir(workspace);
// No current-user credential files are consulted by this isolated probe.
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.XDG_CONFIG_HOME = join(home, ".config");
try {
  const { createExternalRuntimeFacade } =
    await import("../../../apps/zcode-cli/packages/bootstrap/src/app/external-runtime.js");
  const facade = await createExternalRuntimeFacade({
    dbPath: join(directory, "probe.sqlite"),
    workingDirectory: workspace,
    workspaceIdentity: workspace,
    cliStorageRoot: home,
    outerSandboxReady: false,
    recoverOnCreate: false,
  });
  try {
    const reports = [];
    for (const runtimeId of ["claude-cli", "codex-cli"] as const)
      for (const accessMode of ["write", "read"] as const)
        reports.push({
          runtimeId,
          accessMode,
          result: await facade.crewRuntime({ action: "probe", runtimeId, accessMode }),
        });
    await writeFile("/tmp/crew-real-adapter-preflight.json", JSON.stringify(reports, null, 2));
    console.log(JSON.stringify(reports, null, 2));
  } finally {
    await facade.shutdown();
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
