# 设计：kd1 多版本 web-dist 路由

## 目标
relay 单版本部署，web-dist 按版本分目录，relay 根据客户端版本动态路由，解决「本项目运行哪个版本，kd1 远控就哪个版本」。

## 决策
1. web-dist 目录结构：`web-dist/<version>/`（如 `web-dist/v3.14.3/`）
2. connector 启动时 GET `http://127.0.0.1:3030/api/server-info` 读 `version`，bind 帧附加 `zcodeVersion` 上报 relay
3. 失败标记 `unknown`，每 60s 轮询重试；获取后发 `update-version` 帧
4. relay 手机入口按绑定版本 serve `web-dist/<version>/`
5. 版本目录缺失 → 版本不匹配提示页（复用 `sendDeviceError`，readdir 列可用版本 + 最新版本兜底按钮）
6. 旧版本不自动清理；`rsync --delete` 只作用于目标版本子目录
7. `deploy-web-kd1.sh` 改为按版本分目录部署

## 验收
- 手机访问 relay 时，按绑定 PC 版本 serve 匹配的 web-dist
- 版本缺失时给出明确提示（升级/降级引导），不静默 404
- 多版本共存，旧客户端总能匹配到自己的版本
