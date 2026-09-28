// Isolated real stdio probe using the same source selected by Web development startup.
// Does not create a crew execution, send a prompt, call a model, or touch the user's HOME.
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = await realpath(await mkdtemp(join(tmpdir(), "crew-real-probe-")));
const home = join(directory, "home");
const workspace = join(directory, "workspace");
await mkdir(home);
await mkdir(workspace);
const loader = createRequire(join(root, "package.json")).resolve("tsx");
const child = spawn(
  process.execPath,
  [
    "--import",
    pathToFileURL(loader).href,
    join(root, "apps/zcode-cli/packages/cli/src/main.ts"),
    "app-server",
    "--stdio",
  ],
  {
    cwd: workspace,
    env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config") },
    stdio: ["pipe", "pipe", "pipe"],
  },
);
const expected = new Map();
const reports = [];
let buffer = "";
let diagnostic = "";
let timedOut = false;
const timeout = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
}, 45000);
const exit = new Promise((done) => child.once("exit", (code, signal) => done({ code, signal })));
child.stderr.on("data", (chunk) => {
  diagnostic = (diagnostic + chunk.toString()).slice(-24000);
});
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      continue;
    }
    if (!expected.has(frame.id)) continue;
    reports.push({
      ...expected.get(frame.id),
      ...(frame.error ? { error: frame.error } : { result: frame.result }),
    });
    expected.delete(frame.id);
    if (!expected.size) child.stdin.end();
  }
});
let id = 0;
for (const runtimeId of ["claude-cli", "codex-cli"]) {
  for (const accessMode of ["write", "read"]) {
    expected.set(++id, { runtimeId, accessMode });
    child.stdin.write(
      JSON.stringify({
        id,
        method: "crew/runtime",
        params: {
          workspace: { workspacePath: workspace },
          command: { action: "probe", runtimeId, accessMode },
        },
      }) + "\n",
    );
  }
}
try {
  const processExit = await exit;
  clearTimeout(timeout);
  const result = {
    processExit,
    timedOut,
    reports,
    missingResponses: expected.size,
    boundary: "Real source stdio probe with isolated HOME; not browser/Web RPC end-to-end.",
  };
  const output = resolve(process.env.CREW_PROBE_REPORT ?? "/tmp/crew-real-preflight.json");
  await writeFile(output, JSON.stringify(result, null, 2));
  await writeFile(`${output}.stderr`, diagnostic);
  console.log(JSON.stringify(result, null, 2));
  if (timedOut || expected.size || reports.some((entry) => entry.error)) process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await rm(directory, { recursive: true, force: true });
}
