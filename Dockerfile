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
COPY packages/mcp/package.json     packages/mcp/
COPY packages/web/package.json     packages/web/
RUN npm ci

# 源码 + 共享 tsconfig，然后构建全部包（shared→sdk→server→cli→mcp→web）。
COPY tsconfig.base.json ./
COPY packages/ packages/
RUN npm run build

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# npm ci 校验依赖树需要全部 workspace 清单，缺一个都会失败。
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/sdk/package.json     packages/sdk/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json     packages/cli/
COPY packages/mcp/package.json     packages/mcp/
COPY packages/web/package.json     packages/web/
RUN npm ci --omit=dev

# 只带运行时所需的构建产物。保持 monorepo 布局（serveStatic 依赖 cwd=repo 根）：
#   - server/dist : 主服务（含 public/join.html）
#   - shared/dist : server 运行时通过 @club/shared workspace 链接解析
#   - web/dist    : 静态托管的 SPA 产物
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/web/dist    packages/web/dist

# Non-root user for runtime (defense-in-depth: container breakouts can't
# escalate from root inside the container). 'node' user already exists in the
# bookworm-slim image (UID 1000). The /data volume is mounted by docker-compose
# and must be writable by this user.
RUN chown -R node:node /app && \
    mkdir -p /data && \
    chown -R node:node /data
USER node

# Entrypoint: ensure /data is writable by the non-root user. Docker named
# volumes are created root-owned; this chown is idempotent and harmless on
# bind-mounts that already have correct ownership. Runs before CMD.
RUN echo '#!/bin/sh' > /usr/local/bin/entrypoint.sh && \
    echo 'if [ -d /data ] && [ "$(stat -c %u /data 2>/dev/null)" = "0" ]; then' >> /usr/local/bin/entrypoint.sh && \
    echo '  chown -R node:node /data || true' >> /usr/local/bin/entrypoint.sh && \
    echo 'fi' >> /usr/local/bin/entrypoint.sh && \
    echo 'exec "$@"' >> /usr/local/bin/entrypoint.sh && \
    chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# HOST/PORT server 已有默认；CLUB_DB 指向卷内，持久化 SQLite。
ENV HOST=0.0.0.0 \
    PORT=6200 \
    CLUB_DB=/data/club.db

EXPOSE 6200
CMD ["node", "packages/server/dist/index.js"]
