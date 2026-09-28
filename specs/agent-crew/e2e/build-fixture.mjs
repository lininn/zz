import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = resolve(process.argv[2] ?? "/tmp/crew-p01-browser");
await mkdir(output, { recursive: true });
const result = await build({
  entryPoints: [
    resolve(
      root,
      process.env.CREW_E2E_HOME
        ? "specs/agent-crew/e2e/home-fixture.tsx"
        : "specs/agent-crew/e2e/fixture.tsx",
    ),
  ],
  absWorkingDir: root,
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  loader: { ".png": "dataurl", ".svg": "dataurl", ".webp": "dataurl" },
  tsconfig: resolve(root, "packages/ui/tsconfig.json"),
  nodePaths: [resolve(root, "packages/ui/node_modules")],
  alias: { "@": resolve(root, "packages/ui/src") },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env": "{}",
    __ZCODE_VERSION__: '"fixture"',
  },
  logLevel: "warning",
});
const script = result.outputFiles[0].text.replaceAll("</script", "<\\/script");
await writeFile(
  resolve(output, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Crew multiconversation offline interaction fixture</title><style>body{font:16px system-ui;margin:24px;background:#fafafa;color:#111}button,input,textarea,select{font:inherit;margin:6px;padding:8px;max-width:100%;box-sizing:border-box}button{cursor:pointer}section,form{padding:12px;border:1px solid #bbb;margin:12px 0}label{display:inline-block}textarea{display:block;min-width:260px}#root{max-width:900px;margin:auto}[role=alert]{color:#b00}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}[role=dialog],[role=alertdialog]{background:white;border:1px solid;padding:24px;position:fixed;z-index:10;inset:15% 20%;height:max-content}</style><body><p>Offline component fixture — no live runtime or Host.</p><div id="root"></div><script>${script}</script></body></html>`,
);
console.log(resolve(output, "index.html"));
