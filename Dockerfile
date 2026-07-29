# club — 单容器同源部署
#   server (Hono :6200) 同时托管 web 构建产物 + 提供 API + 读写本地 SQLite。
#   选用 bookworm-slim 而非 alpine：better-sqlite3 是原生 C++ 模块，glibc 上的
#   prebuilt 二进制可直接运行，省去 alpine/musl 下安装编译工具链的麻烦。

# ---------- build ----------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# 先拷清单以利用层缓存（npm ci 只在依赖变化时重跑）。
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/sdk/package.json     packages/sdk/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json     packages/cli/
COPY packages/web/package.json     packages/web/
# 编译工具链：node-pty（cli 的 runtime 依赖）在 node20 上没有可用 prebuild，
# npm ci 会退化到 node-gyp 源码编译，需要 python3 + make + g++。只在 build 阶段装，
# 不进 runtime 镜像（多阶段构建丢弃此层）。
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ && \
    rm -rf /var/lib/apt/lists/*
RUN npm ci

# 源码 + 共享 tsconfig，然后构建全部包（shared→sdk→server→cli→web）。
COPY tsconfig.base.json ./
COPY packages/ packages/
RUN npm run build

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# runtime 只跑 server (+ 其 @club/shared 依赖)。cli/sdk/web 的 node 依赖运行时
# 用不到：cli 是本地 TUI(ink/node-pty)；sdk 已打进 web/dist 浏览器 bundle；
# web 运行时仅是静态 dist。npm ci 会装「全部 workspace 的 prod deps 并集」，
# 把 node-pty/mammoth/xlsx/pdf-parse/react-dom/@radix-ui/* … 全塞进镜像。
# 这里把 root workspaces 收敛到 shared/server，只装它们的 prod deps。
# 用 install 而非 ci：精简后 workspaces 与 lockfile(5个) 不一致，ci 会拒绝；
# install 仍读 lockfile 锁定 shared/server 版本，仅整理掉多余的 workspace 条目。
# --ignore-scripts：跳过 root package.json 的 `prepare`(husky) —— 它是 dev 工具，
# 且 husky 在 --omit=dev 下不存在会 exit 127（同时也跳过 better-sqlite3 的
# prebuild-install，故下面补一句 rebuild，否则运行时 "Could not locate the bindings"）。
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.workspaces=p.workspaces.filter(w=>['packages/shared','packages/server'].includes(w));fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
RUN npm install --omit=dev --ignore-scripts && \
    npm rebuild better-sqlite3

# 只带运行时所需的构建产物。保持 monorepo 布局：
#   - server/dist : 主服务（含 public/join.html）
#   - shared/dist : server 运行时通过 @club/shared workspace 链接解析
#   - web/dist    : 静态托管的 SPA 产物（server 经 CLUB_WEB_DIST env 定位，
#                   见 index.ts；npm 包形态则把 SPA 拷进 server/dist/public/spa）
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/web/dist    packages/web/dist

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
# We chown unconditionally — it's a fast no-op when /data is already node-owned
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

# HOST/PORT server 已有默认；CLUB_DB 指向卷内，持久化 SQLite。
# CLUB_FILES 同样指向卷内 /data/files —— 否则上传文件会落进镜像可写层
# (<cwd>/files = /app/files)，容器一重建（compose up / promote / rollback）就全丢，
# 而 DB 里的 files 行还在，导致附件 URL 永久 404。
ENV HOST=0.0.0.0 \
    PORT=6200 \
    CLUB_DB=/data/club.db \
    CLUB_FILES=/data/files \
    CLUB_WEB_DIST=/app/packages/web/dist

EXPOSE 6200
CMD ["node", "packages/server/dist/index.js"]
