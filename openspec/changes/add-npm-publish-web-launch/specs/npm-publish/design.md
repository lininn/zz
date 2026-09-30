# 设计：npm 单体包发布（bin: zz）

## 目标
把 ZCode CLI 发布为 npm 包，用户 `npm install -g <包名>` 后用 `zz` 命令启动，web-dist 内嵌开箱即用。

## 决策
1. bin 名 `zcode` → `zz`（`apps/zcode-cli/packages/cli/package.json`）
2. `CLI_COMMAND_NAME = "zz"`（`process-name.ts`）
3. 去 `private: true`，补 name/description/repository/license
4. web-dist 内嵌：复用 `build-zcode.mjs` 的 `cp(webDist, packageRoot/web)` 逻辑，把 `packages/web/dist` 打进包
5. `packages/zcode-server-cli` 的 bin 名 `zcode` 与 CLI 冲突，npm 发布时只发 CLI 主命令，server-cli 不发布独立 bin（或改名）
6. 包名待定（`zz` 可能被占用），用 `@zcode/zz` 或 `zcode-app`；**包名 ≠ bin 名**

## 验收
- `npm install -g <包名>` 后 `zz --version` 输出版本号
- `npm pack` 产物包含 `dist/zcode.cjs` + `web/` 目录 + package.json bin
