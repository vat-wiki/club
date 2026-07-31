#!/usr/bin/env bash
# club 镜像版本管理（npm semver）+ staging 部署脚本。
#
# 发新版本（两步）：
#   1. ./scripts/version.sh patch  # 或 minor / major；bump root+server 到同一版本 + 自动 commit + 打 git tag v0.x.y
#   2. ./scripts/deploy.sh build   # 读 package.json 版本 → 装 club-serve@<版本> 建镜像 → 写 TEST_TAG → 重启 test(:6600)
# 验证 OK 后：
#   ./scripts/deploy.sh promote            # 把 test 验证通过的版本推广到 prod(:6500)
#   ./scripts/deploy.sh rollback <版本>    # prod 回滚到指定旧版本（旧镜像需仍在本地）
set -euo pipefail
cd "$(dirname "$0")/.."

read_tag() { grep -E "^$1=" .env | head -1 | cut -d= -f2-; }
# .env 被 gitignore，CI / 首次部署时可能不存在。缺失则从 .env.example 初始化一份，
# 并确保目标 tag 键存在且非空（sed 才能原地替换；docker-compose 用 :? 对空值报错）。
ensure_env() {
  [ -f .env ] || cp .env.example .env
  grep -qE "^$1=" .env || echo "$1=" >> .env
}
set_tag()  { ensure_env "$1"; sed -i "s|^$1=.*|$1=$2|" .env; }

case "${1:-}" in
  build)
    VER="$(node -p "require('./package.json').version")"
    docker build --build-arg CLUB_VERSION="$VER" -t "club:$VER" -t club:latest .
    # 首次部署时 .env 可能刚从 .env.example 初始化，PROD_TAG 还是空——
    # 用当前 VER 兠底，避免 docker-compose 的 :? 插值报错。后续 promote 会改写 PROD_TAG。
    [ -n "$(read_tag CLUB_PROD_TAG)" ] || set_tag CLUB_PROD_TAG "$VER"
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
    echo "发新版本前先：./scripts/version.sh patch|minor|major"
    exit 1
    ;;
esac
