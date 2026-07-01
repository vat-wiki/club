#!/usr/bin/env bash
# club 镜像版本管理（npm semver）+ staging 部署脚本。
#
# 发新版本（两步）：
#   1. npm version patch           # 或 minor / major；bump package.json + 自动 commit + 打 git tag v0.x.y
#   2. ./scripts/deploy.sh build   # 读 package.json 版本 → 建 club:<版本> → 写 TEST_TAG → 重启 test(:6600)
# 验证 OK 后：
#   ./scripts/deploy.sh promote            # 把 test 验证通过的版本推广到 prod(:6500)
#   ./scripts/deploy.sh rollback <版本>    # prod 回滚到指定旧版本（旧镜像需仍在本地）
set -euo pipefail
cd "$(dirname "$0")/.."

read_tag() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
set_tag()  { sed -i "s|^$1=.*|$1=$2|" .env; }

case "${1:-}" in
  build)
    VER="$(node -p "require('./package.json').version")"
    docker build -t "club:$VER" -t club:latest .
    set_tag CLUB_TEST_TAG "$VER"
    docker compose up -d club-test
    echo "✓ test 现在跑 club:$VER（:6600）。验证 OK 后：./scripts/deploy.sh promote"
    ;;
  promote)
    NEW="$(read_tag CLUB_TEST_TAG)"
    set_tag CLUB_PROD_TAG "$NEW"
    docker compose up -d club
    echo "✓ prod 推广到 club:$NEW（:6500）"
    ;;
  rollback)
    VER="${2:?用法: $0 rollback <版本>}"
    docker image inspect "club:$VER" >/dev/null 2>&1 || { echo "✗ 镜像 club:$VER 不存在（可能已被 docker image prune 清掉）"; exit 1; }
    set_tag CLUB_PROD_TAG "$VER"
    docker compose up -d club
    echo "✓ prod 回滚到 club:$VER（:6500）"
    ;;
  *)
    echo "用法: $0 {build|promote|rollback <版本>}"
    echo "发新版本前先：npm version patch|minor|major"
    exit 1
    ;;
esac
