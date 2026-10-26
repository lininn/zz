#!/usr/bin/env node
/**
 * 组装可发布的 npm 包目录：dist/npm/
 *
 * 与源码目录解耦的原因：workspace 依赖（@zcode/*）不能出现在发布产物里
 * （npm 不认 `workspace:` 协议，装不上），而 bundle 已经把这些包内联进
 * dist/zcode.cjs / dist/server.mjs。这里产出一份只含真实运行时依赖的 package.json。
 *
 * 产物布局（bin 指向 dist/zcode.cjs）：
 *   dist/npm/dist/zcode.cjs          CLI 主 bundle（minify，无 sourcemap）
 *   dist/npm/dist/server.mjs         `zz --web` 内嵌的 server 单文件 bundle
 *   dist/npm/dist/web/**             web 静态资源（已剔除 sourcemap）
 *   dist/npm/dist/tui/index.js       vendored TUI 运行时
 *   dist/npm/package.json            干净的发布清单
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildCli } from "./build.mjs";

const cliRoot = resolve(import.meta.dirname, "..");
const projectRoot = resolve(cliRoot, "../.."); // apps/zcode-cli
const repoRoot = resolve(projectRoot, "../.."); // 仓库根
const binDir = resolve(repoRoot, "node_modules/.bin");
const tuiRoot = resolve(projectRoot, "packages/tui");
const webRoot = resolve(repoRoot, "packages/web");
const serverRoot = resolve(repoRoot, "packages/server");
const stagingRoot = resolve(cliRoot, "dist/npm");
const stagingDist = resolve(stagingRoot, "dist");

/** dist/server.mjs 与 dist/tui 等运行时依赖，均为 npm 上真实存在的包。 */
const publishedDependencies = {
  "@hono/node-server": "^1.19.11",
  "@hono/node-ws": "^1.3.0",
  "@mbears/opentui-core": "0.2.15",
  "@mbears/opentui-react": "0.2.15",
  axios: "^1.13.6",
  "combined-stream": "^1.0.8",
  dotenv: "^17.4.2",
  "follow-redirects": "^1.16.0",
  "form-data": "^4.0.5",
  hono: "^4.12.9",
  koffi: "2.15.6",
  "node-forge": "^1.4.0",
  "node-pty": "^1.0.0",
  "playwright-core": "1.59.1",
  "proxy-from-env": "^1.1.0",
  react: "^19.2.5",
  shiki: "^4.1.0",
  ssh2: "^1.17.0",
  undici: "^6.24.1",
  ws: "^8.20.0",
  yaml: "^2.9.0",
  yauzl: "^3.3.0",
  yazl: "^3.3.1",
};

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

async function assertExists(path, label) {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
}

async function buildDependencies() {
  // web 必须重建，否则发布的是旧的 UI 产物。
  run(resolve(binDir, "vite"), ["build"], webRoot);
  run(resolve(binDir, "tsup"), ["--config", "tsup.npm.config.ts"], serverRoot);
  run(process.execPath, [resolve(tuiRoot, "scripts/build.mjs")], tuiRoot);
}

async function writeStagedManifest() {
  const source = JSON.parse(await readFile(resolve(cliRoot, "package.json"), "utf8"));
  const manifest = {
    name: source.name,
    version: source.version,
    description: source.description,
    license: source.license,
    repository: source.repository,
    homepage: source.homepage,
    bugs: source.bugs,
    bin: source.bin,
    files: ["dist", "README.md", "README.en.md"],
    type: source.type,
    main: source.main,
    engines: { node: ">=24.0.0" },
    dependencies: publishedDependencies,
  };
  await writeFile(resolve(stagingRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function stageRuntime() {
  const webDist = resolve(webRoot, "dist");
  const serverBundle = resolve(serverRoot, "dist-npm/entry-http.js");
  const tuiBundle = resolve(tuiRoot, "dist/index.js");
  await assertExists(webDist, "web dist");
  await assertExists(serverBundle, "server npm bundle");
  await assertExists(tuiBundle, "tui bundle");

  await rm(stagingRoot, { force: true, recursive: true });
  await mkdir(stagingDist, { recursive: true });

  await cp(resolve(cliRoot, "dist/zcode.cjs"), resolve(stagingDist, "zcode.cjs"));
  // 运行期必需：CLI 在 entryDirectory/provider/zcode-builtin.json 读取内建 Provider 配置。
  await cp(resolve(cliRoot, "dist/provider"), resolve(stagingDist, "provider"), {
    recursive: true,
  });
  await cp(
    resolve(cliRoot, "dist/THIRD-PARTY-NOTICES.md"),
    resolve(stagingDist, "THIRD-PARTY-NOTICES.md"),
  );
  await cp(resolve(serverBundle), resolve(stagingDist, "server.mjs"));
  await mkdir(resolve(stagingDist, "tui"), { recursive: true });
  await cp(tuiBundle, resolve(stagingDist, "tui/index.js"));
  // sourcemap 约占 web 产物的 55%（~80MB），发布包不需要。
  await cp(webDist, resolve(stagingDist, "web"), {
    recursive: true,
    filter: (source) => !source.endsWith(".map"),
  });
  await cp(resolve(cliRoot, "README.md"), resolve(stagingRoot, "README.md"));
  await cp(resolve(cliRoot, "README.en.md"), resolve(stagingRoot, "README.en.md"));
  await cp(resolve(repoRoot, "LICENSE"), resolve(stagingRoot, "LICENSE"));
  await cp(resolve(repoRoot, "THIRD-PARTY-NOTICES.md"), resolve(stagingRoot, "THIRD-PARTY-NOTICES.md"));
}

await buildDependencies();
await buildCli({
  cliDirectory: cliRoot,
  rootDirectory: projectRoot,
  minify: true,
  sourcemap: false,
});
await stageRuntime();
await writeStagedManifest();

console.log(`[npm-package] staged publishable package at ${stagingRoot}`);
