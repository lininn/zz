# 设计：zz --web 命令

## 目标
`zz --web` 一键启动 Web 聊天页面，生产模式不用 Vite，用内嵌 Hono server + staticRoot 托管 web-dist。

## 决策
1. `arguments.ts` 注册 `--web`（boolean）+ `--web-port`（string）
2. `run.ts` 新增分支：`--web` → 启动内嵌 server + 托管 web-dist + 打开浏览器
3. 复用 `webConfigCommand.ts` 的端口探测 + 打开浏览器逻辑
4. 默认端口 3030（与 server 一致），`--web-port` 覆盖，占用自动回退（上限 10 次）
5. web-dist 路径解析：npm 安装后与 CLI 同目录（`path.join(__dirname, "web")`）

## 验收
- `zz --web` 启动后自动打开浏览器，访问本机 web 聊天页面
- 页面能通过 `/ws` 连接本地 ZCode agent（RPC 连通）
- 端口被占时自动回退到下一个可用端口，并在终端/页面提示
