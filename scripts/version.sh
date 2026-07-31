#!/usr/bin/env bash
# club 发版：bump root + packages/server 到同一版本，一次 commit + 打 tag。
#
# 为什么不是 `npm version`：
#   镜像 tag 取自 root package.json 的 version；镜像内容来自已发布的
#   `club-serve` npm 包（其 version 在 packages/server/package.json）。两者必须
#   相等，`docker build --build-arg CLUB_VERSION=<ver>` 才能装到对应版本。
#   `npm version` 一次只 bump 一个 package.json（还会各自按自身版本递增），会让
#   root 与 server 走散；本脚本把它们一起设到同一个新版本。
#
# 用法：
#   ./scripts/version.sh patch     # 或 minor / major
#   git push --follow-tags         # CI 先 publish npm 包，再 build 镜像 -> 部署 test
set -euo pipefail
cd "$(dirname "$0")/.."

LEVEL="${1:?用法: $0 patch|minor|major}"
case "$LEVEL" in
  patch|minor|major) ;;
  *) echo "✗ 级别必须是 patch|minor|major" >&2; exit 1 ;;
esac

# 干净工作区（与 `npm version` 一致），避免把无关改动混进 release commit。
git diff --quiet        || { echo "✗ 工作区有未暂存改动，先 commit 或 stash" >&2; exit 1; }
git diff --cached --quiet || { echo "✗ 工作区有已暂存改动，先 commit 或 stash" >&2; exit 1; }

ROOT_V="$(node -p "require('./package.json').version")"
SRV_V="$(node -p "require('./packages/server/package.json').version")"
if [ "$ROOT_V" != "$SRV_V" ]; then
  echo "✗ root($ROOT_V) 与 server($SRV_V) 版本不一致，先手动对齐再发版" >&2
  exit 1
fi

# bump root（--no-git-tag-version 不自动 commit/tag），取输出的新版本号。
# npm version 会同步更新 package-lock.json 顶层的 version 字段，一并提交。
NEW="$(npm version "$LEVEL" --no-git-tag-version | tail -1 | sed 's/^v//')"
# server 显式设成同一版本：对 server 跑 `npm version` 会按 server 自身版本递增 -> 走散。
node -e "const fs=require('fs'),p='packages/server/package.json';const j=JSON.parse(fs.readFileSync(p));j.version='$NEW';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')"

git add package.json package-lock.json packages/server/package.json
git commit -m "release: v$NEW" >/dev/null
git tag "v$NEW"

echo "✓ v$NEW 已 commit + 打 tag。接下来：git push --follow-tags  (CI publish -> deploy test)"
