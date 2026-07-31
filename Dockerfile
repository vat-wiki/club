# club - 单容器部署：直接装已发布的 club-serve npm 包。
#   club-serve 在 npm 上是自包含的：@club/shared 已被 tsup 内联进 dist/index.js，
#   web SPA 已烤进 dist/public/spa（server 经 __dirname 定位，无需 CLUB_WEB_DIST），
#   better-sqlite3 在 glibc 上有 prebuilt 二进制。所以一个 `npm install -g` 就是整
#   个镜像——没有源码构建、没有编译工具链、没有 monorepo workspace 过滤。
#   选 bookworm-slim 而非 alpine：better-sqlite3 是原生 C++ 模块，glibc 上的 prebuilt
#   可直接跑，省去 alpine/musl 下装编译工具链的麻烦。
#
# 版本由 --build-arg CLUB_VERSION 传入（= root/server package.json 的 version）。
# deploy.sh 读 root 版本传入；手动构建须自带，例如：
#   docker build --build-arg CLUB_VERSION=0.1.8 -t club:0.1.8 .

FROM node:20-bookworm-slim
ARG CLUB_VERSION
WORKDIR /app
ENV NODE_ENV=production

RUN test -n "$CLUB_VERSION" && npm install -g "club-serve@$CLUB_VERSION"

ENV HOST=0.0.0.0 \
    PORT=6200 \
    CLUB_DB=/data/club.db \
    CLUB_FILES=/data/files
# CLUB_WEB_DIST 不再需要：SPA 已在 club-serve 的 dist/public/spa，server 经
# __dirname 自动定位。CLUB_DB/CLUB_FILES 指向卷内 /data，持久化 SQLite 与上传文件
# （否则落进镜像可写层，容器一重建就全丢，DB 里的行还在 -> 附件 URL 永久 404）。
# club-serve bin 默认数据走 ~/.club，但这两个 env 优先级更高，故 /data 仍生效。

# gosu: drop privileges from root (entrypoint) to the non-root 'node' user
# after fixing up /data ownership. Lighter than installing sudo and, unlike
# `su`, execs the child directly so signals (SIGTERM) propagate cleanly.
RUN apt-get update && apt-get install -y --no-install-recommends gosu && \
    rm -rf /var/lib/apt/lists/*

# Non-root user for runtime (defense-in-depth: container breakouts can't
# escalate from root inside the container). 'node' user already exists in the
# bookworm-slim image (UID 1000). The /data volume is mounted by docker-compose
# and must be writable by this user.
RUN chown -R node:node /app && \
    mkdir -p /data && \
    chown -R node:node /data

# Entrypoint: ensure /data is writable by the non-root user, then drop to 'node'.
# Docker named volumes are created root-owned (uid 0); a non-root process cannot
# chown them, so the chown MUST run as root here, BEFORE gosu drops privileges.
# We chown unconditionally - it's a fast no-op when /data is already node-owned
# (e.g. a bind-mount with correct ownership, or a previously-fixed volume) and
# fixes the fresh-root-owned-volume case. Only the server (CMD) runs as node;
# PID 1 stays root just long enough to fix perms, matching the common pattern.
RUN printf '%s\n' \
    '#!/bin/sh' \
    'set -e' \
    'if [ -d /data ]; then' \
    '  chown -R node:node /data' \
    'fi' \
    'exec gosu node "$@"' > /usr/local/bin/entrypoint.sh && \
    chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

EXPOSE 6200
CMD ["club-serve"]
