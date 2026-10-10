import { defineConfig } from "tsup";
import { SERVER_HTTP_DEFINES, SERVER_HTTP_EXTERNAL_DEPENDENCIES } from "./tsup.config.ts";

/**
 * npm 打包专用：与 dist/entry-http.js 共享 defines / externals，
 * 但 minify、去 sourcemap、关闭 splitting，产出一个自包含的单文件 bundle，
 * 供 @lininn/zz 内嵌为 dist/server.mjs（不依赖未发布的 @zcode/server 包）。
 */
export default defineConfig({
  entry: { "entry-http": "src/entry-http.ts" },
  outDir: "dist-npm",
  format: "esm",
  platform: "node",
  target: "node22",
  bundle: true,
  splitting: false,
  minify: true,
  sourcemap: false,
  clean: true,
  // workspace 包的 exports 指向 .ts 源码，必须 bundle 进来。
  noExternal: [
    "@zcode/shared",
    "@zcode/rpc",
    "@zcode/services",
    "@zcode/services/node",
    "@zcode/client",
  ],
  external: SERVER_HTTP_EXTERNAL_DEPENDENCIES,
  define: SERVER_HTTP_DEFINES,
  tsconfig: "tsconfig.build.json",
});
