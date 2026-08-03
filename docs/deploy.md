# 部署指南

club 可以**一条命令**在本地跑起来，也可以用 **Docker** 自托管给团队用。两种方式打的是同一个全栈（API + Web UI + SQLite）。

---

## 一、一键运行（本地 / 单机）

`club-serve` 把整个 club 打包成一个 npm 包。一条命令起全栈：

```bash
npx club-serve
# → club server listening on http://0.0.0.0:6200
# → 浏览器开 http://localhost:6200/join 拿 key，再开 http://localhost:6200 进聊天
```

### 命令行参数

```bash
npx club-serve --port 8080            # 自定义端口（默认 6200）
npx club-serve --host 127.0.0.1       # 只监听本机（默认 0.0.0.0）
npx club-serve --data-dir ./my-club   # club.db + 文件落到 ./my-club
npx club-serve --help                 # 看全部选项
```

### 数据落哪

默认 `~/.club/`（**不是**当前工作目录），这样从任意目录 `npx club-serve` 都不会弄脏工作目录。

- `~/.club/club.db` —— SQLite 数据库。
- `~/.club/files/` —— 上传的附件。

### 全局安装（推荐长期使用）

```bash
npm install -g club-serve club-cli
club-serve          # 起服务器
club                # CLI（另一个终端）
```

---

## 二、环境变量

所有变量都可选；命令行参数和显式 env 优先级高于默认值。

| 变量 | 默认 | 作用 |
|---|---|---|
| `PORT` | `6200` | 监听端口。 |
| `HOST` | `0.0.0.0` | 监听地址。只想本机访问设 `127.0.0.1`。 |
| `CLUB_DB` | `~/.club/club.db` | SQLite 数据库路径。 |
| `CLUB_FILES` | `~/.club/files` | 附件存储目录。 |
| `ALLOWED_ORIGINS` | （空） | 允许跨域的源，逗号分隔，如 `https://club.example.com`。**生产环境前端与 API 不同源时必须配**。 |
| `TRUSTED_PROXY` | （空） | `=true` 时限流按 `X-Forwarded-For` 真实客户端 IP 分桶。仅当 club 在会**覆写** XFF 的可信反代（nginx/caddy）之后时才开。 |
| `CLUB_WEB_DIST` | （内置） | 指向你自建的 Web 前端 `dist`（自定义 UI 时用）。club-serve 已内置 SPA，一般不用动。 |
| `NODE_ENV` | — | `=production` 时，未设 `ALLOWED_ORIGINS` 则**拒绝所有跨域**（更安全）。 |

### 跨域（CORS）规则

- **开发**（无 `ALLOWED_ORIGINS` 且非 production）：开放 `*`，方便局域网/本机。
- **生产**（`NODE_ENV=production` 且无 `ALLOWED_ORIGINS`）：**拒绝所有跨域**——任意第三方网站调不了 API。同源部署（SPA 与 API 共用同一个 `club:port`）无需配置。
- **前后端分源**：把 `ALLOWED_ORIGINS` 设成前端地址。

---

## 三、Docker 部署（团队 / 生产）

Docker 镜像直接装已发布的 `club-serve` npm 包——自包含（SPA 已烤进 dist，`@club/shared` 已内联），不需要源码构建。**bookworm-slim**（glibc）而非 alpine，省去 `better-sqlite3` 在 musl 下的编译。

### 平台支持

| 平台 | 方式 |
|---|---|
| **glibc Linux** / **macOS** | `npx club-serve` 开箱即用（预编译二进制） |
| **Windows** / **arm64-Linux** / **Alpine(musl)** | 用 Docker 镜像（原生模块否则要源码编译） |

### docker-compose（prod + staging 双环境）

仓库自带 `docker-compose.yml`：一台机器、两个容器、按端口区分（内网，无 TLS）：

| 服务 | 端口 | 用途 |
|---|---|---|
| `club` | `6500:6200` | 生产 |
| `club-test` | `6600:6200` | 预发布 / staging |

镜像版本用 npm semver 管理：`.env` 里 `CLUB_PROD_TAG` / `CLUB_TEST_TAG` 各 pin 各的版本——staging 跑新版验证时 prod 仍停在旧版，验证 OK 再 promote。

```bash
# .env（首次部署前手动填具体版本）
CLUB_PROD_TAG=0.1.9
CLUB_TEST_TAG=0.1.9
```

> **挂整个 `/data` 目录**，不是单个 `club.db`——WAL 模式会生成 `club.db-wal` / `club.db-shm`，单文件挂载会丢掉它们、重启后丢数据。

### 发版与部署脚本

```bash
./scripts/version.sh patch         # bump 版本（root+server）+ commit + 打 tag v0.x.y
git push --follow-tags             # CI: publish club-serve/club-cli → 建镜像 → 部署 staging(:6600)
./scripts/deploy.sh build          # 本地建镜像 → 写 TEST_TAG → 重启 test(:6600)
./scripts/deploy.sh promote        # 把 test 验证通过的版本推广到 prod(:6500)
./scripts/deploy.sh rollback <版本> # prod 回滚到指定版本
```

### 生产前置：反向代理 + TLS

club 容器本身**不提供 HTTPS**。生产对外暴露时，前面放 nginx/caddy 做反代和 TLS：

```nginx
# nginx 示例
server {
    listen 443 ssl http2;
    server_name club.example.com;

    location / {
        proxy_pass http://127.0.0.1:6500;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;  # 覆写 XFF
        proxy_buffering off;            # SSE 必须关缓冲，否则实时消息卡住
        proxy_read_timeout 86400s;      # SSE 长连接
    }
}
```

反代就位后，**开 `TRUSTED_PROXY=true`**——让限流按 XFF 里的真实客户端 IP 分桶，否则所有请求都算到反代同一个 IP，15/min 写限额全站共享、多人并发频繁 429。

> ⚠️ 只有反代**会覆写 XFF** 时才开 `TRUSTED_PROXY`。裸 Docker 端口映射不产生 XFF，开了无效；不覆写 XFF 的环境下开它，攻击者能伪造该头绕过 per-IP 限流。

并设 `ALLOWED_ORIGINS=https://club.example.com`（如果前后端分源）。

### 手动构建镜像（不走 CI）

```bash
docker build --build-arg CLUB_VERSION=0.1.9 -t club:0.1.9 .
# 改 .env 里的 tag，再 docker compose up -d club
```

---

## 四、从源码开发

```bash
git clone https://github.com/vat-wiki/club
cd club
npm install
npm run build                 # 构建 shared, sdk, server, cli, web

# 起后端 + Web dev server（两个终端）
npm -w club-serve run dev     # http://localhost:6200 · /join 拿 key
npm -w @club/web run dev      # http://localhost:6100 · 聊天 UI（代理 API 到 :6200）
```

> 改 `@club/shared` / `@club/sdk` 后，依赖它们的端（web/cli/server）要重新构建——这俩的 dist 容易过期。

### 文档站本地预览

```bash
npm run docs:dev              # VitePress 文档站（就是你在看的这个）
```

---

## 运维要点

- **健康检查**：`GET /health` 返回 `{ ok: true }`，无 DB 查询，适合做 liveness 探针（docker-compose 已配 healthcheck）。
- **优雅关闭**：容器收到 SIGTERM 会排空连接后退出（5s 强退兜底）。
- **数据库迁移**：SQLite 迁移链 v1–v18，启动时自检、幂等、无依赖。
- **备份**：定期备份 `CLUB_DB` 指向的 `club.db`（停服或用 SQLite 在线备份，避免 WAL 不一致）。

下一步：[`故障排查`](./troubleshooting)，或回 [`CLI 命令参考`](./cli)。
