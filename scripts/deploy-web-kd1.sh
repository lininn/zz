#!/bin/zsh
# 构建 ZCode web 并部署到 kd1 中转（pc.d-1.top 页面即时生效，无需重启容器）
# 多版本共存：部署到 web-dist/<version>/，旧版本保留，互不覆盖
set -e
cd /Users/lininn/test/ZCode

# 版本号：必须用 package.json（与 server/web 构建注入的 ZCODE_VERSION 一致），
# 不能用 git tag——否则 server 上报 3.14.0、部署到 web-dist/3.14.3/，路由 404。
VERSION=$(node -p "require('./package.json').version")
echo "部署版本: $VERSION"

echo "[1/2] 构建 web..."
pnpm --filter @zcode/web build 2>&1 | tail -1

echo "[2/2] 部署到 kd1 (web-dist/$VERSION/)..."
# --delete 只作用于目标版本子目录内，不删除兄弟版本目录
rsync -a --delete -e ssh packages/web/dist/ "kd1:/opt/zcode-relay/web-dist/$VERSION/"
echo "完成：手机/网页清缓存或强刷 pc.d-1.top 即见最新页面（版本 $VERSION）"
