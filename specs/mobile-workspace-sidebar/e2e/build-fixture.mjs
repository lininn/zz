import { build } from "esbuild";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const settings = process.argv.includes("--settings");
const output = resolve(
  process.argv.slice(2).find((arg) => arg !== "--settings") ??
    (settings ? "/tmp/zcode-settings-sidebar-browser" : "/tmp/zcode-mobile-sidebar-browser"),
);
const ui = resolve(root, "packages/ui/src");
await mkdir(output, { recursive: true });
const result = await build({
  entryPoints: [
    resolve(
      root,
      `specs/mobile-workspace-sidebar/e2e/${settings ? "settings-fixture" : "fixture"}.tsx`,
    ),
  ],
  absWorkingDir: root,
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  tsconfig: resolve(root, "packages/ui/tsconfig.json"),
  nodePaths: [resolve(root, "packages/ui/node_modules")],
  alias: { "@": ui },
  loader: { ".svg": "dataurl", ".png": "dataurl" },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env": "{}",
    __ZCODE_VERSION__: '"fixture"',
  },
  logLevel: "warning",
});
// 编译真实样式，不用仿造的 CSS 证明触达尺寸、定位或宽度动画。
const compiler = await compile(await readFile(resolve(ui, "styles.css"), "utf8"), {
  base: ui,
  onDependency: () => {},
});
const scanner = new Scanner({
  sources: [
    ...compiler.sources,
    { base: ui, pattern: "**/*.{ts,tsx}", negated: false },
    { base: root, pattern: "specs/mobile-workspace-sidebar/e2e/*.tsx", negated: false },
  ],
});
const css = compiler.build(scanner.scan()).replaceAll("</style", "<\\/style");
const script = result.outputFiles[0].text.replaceAll("</script", "<\\/script");
await writeFile(
  resolve(output, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${settings ? "Settings" : "Workspace"} sidebar fixture</title><style>${css}</style><body><div id="root"></div><script type="module">${script}</script></body></html>`,
);
console.log(resolve(output, "index.html"));
