#!/bin/zsh
# 构建 ZCode web 并部署到 kd1 中转（pc.d-1.top 页面即时生效，无需重启容器）
#
# 多版本共存：产物落在 web-dist/<version>/，relay 按 connector 上报的
# /api/server-info.version（如 3.14.0）路由到同名目录；目录缺失时显示版本不匹配页。
# 目录名必须是裸版本号（不带 v）——那是设备上报的格式；relay 也兼容历史的 v 前缀。
# 版本号取 package.json：web 构建注入的 __ZCODE_VERSION__ 与 server 上报的版本都源自它，
# 用 git tag 会和设备上报的版本错开，导致路由到不存在的目录。
set -e
cd /Users/lininn/test/ZCode

VERSION=$(node -p "require('./package.json').version")
echo "部署版本: $VERSION"

echo "[1/3] 构建 web..."
pnpm --filter @zcode/web build 2>&1 | tail -1

echo "[2/3] 同步到 kd1 (web-dist/$VERSION/)..."
# --delete 只作用于目标版本子目录内，不删除兄弟版本目录。
# sourcemap 只服务本地调试，去掉可让单版本产物从 ~145MB 降到 ~65MB。
rsync -a --delete --exclude='*.map' -e ssh packages/web/dist/ "kd1:/opt/zcode-relay/web-dist/$VERSION/"

echo "[3/3] 校验远端..."
ssh kd1 "test -f /opt/zcode-relay/web-dist/$VERSION/index.html && du -sh /opt/zcode-relay/web-dist/$VERSION && ls -1 /opt/zcode-relay/web-dist/"
echo "完成：pc.d-1.top 会按设备上报版本 $VERSION 命中该目录（清缓存或强刷即可看到新页面）"
