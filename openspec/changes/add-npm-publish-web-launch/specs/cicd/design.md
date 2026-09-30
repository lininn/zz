# 设计：CI/CD 流水线

## 目标
push tag 后自动构建、发布 npm、同步 web-dist 到 kd1 多版本目录。

## 决策
1. 触发：push tag（`v*`）
2. 步骤：
   - `pnpm install` + `pnpm build:bootstrap`
   - `npm publish`（发布 CLI 单体包）
   - 构建 web-dist → `rsync` 到 kd1 `web-dist/<version>/`
3. 凭证：
   - npm token → CI secrets
   - kd1 ssh/rsync 凭证 → CI secrets
4. 复用现有 `deploy-web-kd1.sh`，改为按版本分目录

## 验收
- push tag 后全链路自动完成
- npm 包发布成功
- kd1 web-dist 出现新版本目录
