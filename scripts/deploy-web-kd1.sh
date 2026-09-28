#!/bin/zsh
# 构建 ZCode web 并部署到 kd1 中转（pc.d-1.top 页面即时生效，无需重启容器）
set -e
cd /Users/lininn/test/ZCode
echo "[1/2] 构建 web..."
pnpm --filter @zcode/web build 2>&1 | tail -1
echo "[2/2] 部署到 kd1..."
rsync -a --delete -e ssh packages/web/dist/ kd1:/opt/zcode-relay/web-dist/
echo "完成：手机/网页清缓存或强刷 pc.d-1.top 即见最新页面"
