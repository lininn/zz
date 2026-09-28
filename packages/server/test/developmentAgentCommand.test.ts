import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createDevelopmentAgentCommandResolver } from "../src/developmentAgentCommand.js";

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "crew-web-source-")));
  const cli = join(root, "apps/zcode-cli/packages/cli");
  await mkdir(join(cli, "src"), { recursive: true });
  await mkdir(join(cli, "dist"), { recursive: true });
  await mkdir(join(root, "node_modules/tsx"), { recursive: true });
  await writeFile(join(root, "package.json"), "{}");
  await writeFile(join(root, "node_modules/tsx/package.json"), '{"exports":"./loader.mjs"}');
  await writeFile(join(root, "node_modules/tsx/loader.mjs"), "");
  await writeFile(join(cli, "src/main.ts"), "");
  await writeFile(join(cli, "dist/zcode.cjs"), "// stale bundle without crew/runtime");
  return { root, cli, close: () => rm(root, { recursive: true, force: true }) };
}

const context = {
  workspacePath: "/workspace with spaces",
  workspaceIdentity: "identity",
  workspaceKey: "identity",
};

test("Web source resolver ignores existing stale dist and preserves workspace cwd without env changes", async () => {
  const f = await fixture();
  try {
    const resolver = createDevelopmentAgentCommandResolver(
      f.root,
      () => {
        throw new Error("must not fall back");
      },
      {},
    );
    const command = await resolver(context);
    assert.deepEqual(command, {
      command: process.execPath,
      args: [
        "--import",
        pathToFileURL(join(f.root, "node_modules/tsx/loader.mjs")).href,
        join(f.cli, "src/main.ts"),
        "app-server",
        "--stdio",
      ],
      cwd: context.workspacePath,
      supportsStorageStartup: true,
    });
  } finally {
    await f.close();
  }
});

test("explicit Agent command remains owned by the existing resolver", async () => {
  const override = {
    command: "/custom/agent",
    args: ["custom"],
    cwd: "/custom/cwd",
    env: { PATH: "/custom/bin" },
  };
  const resolver = createDevelopmentAgentCommandResolver(
    "/not-used",
    (target) => {
      assert.equal(target, context);
      return override;
    },
    { ZCODE_AGENT_SERVER_COMMAND: " /custom/agent " },
  );
  assert.equal(await resolver(context), override);
});

test("missing development source fails closed instead of executing stale dist", async () => {
  const f = await fixture();
  try {
    await rm(join(f.cli, "src/main.ts"));
    const resolver = createDevelopmentAgentCommandResolver(
      f.root,
      () => {
        throw new Error("must not fall back");
      },
      {},
    );
    await assert.rejects(async () => resolver(context), /ENOENT/);
  } finally {
    await f.close();
  }
});
