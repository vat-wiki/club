# 部署运维

club 采用 **docker-compose 双环境**（prod / staging）+ **npm semver 版本管理**。所有日常操作应使用 [`scripts/deploy.sh`](../scripts/deploy.sh)，不要手动改 .env 或 docker compose up。

## 前提

- Docker Engine + Docker Compose v2（`docker compose`，注意是 compose 不是 -f）
- Node 20+（仅用于本地构建 + 版本 bump）
- 已有共享内网 `dev-lan`（与同机其它容器同网段）

## 目录

- [首次部署](#首次部署)
- [发新版本](#发新版本)
- [从 staging 推广到生产](#从-staging-推广到生产)
- [回滚](#回滚)
- [.env 配置](#env-配置)
- [健康检查](#健康检查)
- [日志](#日志)
- [数据库备份](#数据库备份)
- [常见故障排查](#常见故障排查)

## 首次部署

```bash
# 1. 进入仓库根
cd /home/dev/repos/club

# 2. 初始构建镜像
docker build -t club:latest .

# 3. 创建 .env 并填入版本
cp .env.example .env
# 编辑 .env，填入初始版本（例如 0.1.0）
#   CLUB_TEST_TAG=0.1.0
#   CLUB_PROD_TAG=0.1.0

# 4. 启动双环境
docker compose up -d club club-test
```

启动后：

| 环境 | 容器 | 内网 IP | host 端口 | 用途 |
|------|------|---------|-----------|------|
| staging | club-test | 10.88.0.22 | :6600 | 预发布验证 |
| prod | club | 10.88.0.21 | :6500 | 生产 |

首次访问 `http://localhost:6500/join` 创建发 key 页、注册用户。

## 发新版本

```bash
# 1. bump 版本（自动 commit + git tag）
npm version patch   # 或 minor / major

# 2. 构建新版镜像，推到 staging 验证
./scripts/deploy.sh build
# → 读取 package.json version，建 club:<版本>，写 TEST_TAG，重启 club-test(:6600)

# 3. 在 staging 上手动验证核心路径
#   - 发消息 / 收消息
#   - @mention
#   - 登录 / 列表
#   - 浏览器访问 UI

# 4. 验证 OK 后推广到生产（见下节）
```

## 从 staging 推广到生产

```bash
./scripts/deploy.sh promote
# → 读取 TEST_TAG 写入 PROD_TAG，重启 club(:6500)
```

**promote 不会覆盖旧镜像**，所以回滚总是可用的（只要旧镜像还在本地）。

## 回滚

```bash
# 列出本地已有镜像
docker image ls club

# 回滚 prod 到指定版本
./scripts/deploy.sh rollback 0.1.3
```

如果指定版本镜像已被 `docker image prune` 清掉，rollback 会报 `✗ 镜像 club:<版本> 不存在`。此时需重新 `docker build -t club:<版本> .`（切到对应 git tag）。

## .env 配置

[`.env.example`](../.env.example) 包含当前全部可配置项：

| 变量 | 说明 |
|------|------|
| `CLUB_TEST_TAG` | staging 容器使用的镜像 tag |
| `CLUB_PROD_TAG` | prod 容器使用的镜像 tag |

容器运行时：

| 环境变量 | 说明 | 默认 |
|----------|------|------|
| `CLUB_DB` | SQLite 数据库路径（卷内） | `/data/club.db` |
| `HOST` | 服务监听地址 | `0.0.0.0` |
| `PORT` | 服务监听端口 | `6200`（容器内） |

## 健康检查

两个容器都配了 healthcheck：每 30s 请求 `/health`，连续失败 3 次判为不健康。

```bash
# 查看健康状态
docker compose ps

# 手动检测
curl -f http://localhost:6500/health && echo " OK" || echo " FAIL"
curl -f http://localhost:6600/health && echo " OK" || echo " FAIL"
```

## 日志

```bash
# 实时 tail prod
docker compose logs -f club

# 最近 100 行
docker compose logs --tail=100 club
```

宿主机日志目录 `scripts/logs/` 可由外部 daemon 写入辅助日志。

## 数据库备份

SQLite 数据库存储在 Docker named volume `club-data-prod` 和 `club-data-test` 中。

```bash
# 备份 prod 数据库到宿主机
docker run --rm -v club-data-prod:/data alpine:3 sh \
  -c 'cp /data/club.db /backup/club-$(date +%F).db' \
  && cp /backup/club-$(date +%F).db ./scripts/logs/

# 恢复（⚠️ 会覆盖现有库）
# 1. docker compose stop club
# 2. 把 .db 放回到 /var/lib/docker/volumes/club-data-prod/_data/
# 3. docker compose start club
```

**建议**：用 cron + 上面的备份命令每天备份一次 prod 库，保存最近 7 天。

## 常见故障排查

| 现象 | 可能原因 | 排查 |
|------|----------|------|
| 容器反复重启 | 端口被占用 / healthcheck 失败 | `docker compose ps` 看状态，`docker compose logs` 看日志 |
| `/join` 404 | 未在浏览器打开，或 prod 未启动 | `curl -f http://localhost:6500/join` |
| 消息发不出 | key 不对 / server 未鉴权通过 | 检查 header `Authorization: Bearer <key>` |
| rollback 失败 | 旧镜像已被 prune | 切到对应 git tag 重新 build |
| `docker compose up` 报错 "network not found" | dev-lan 网络不存在 | `docker network ls` 确认，或用 `docker network create dev-lan` 手动建 |

## 不做什么

- **不做自动 promote**：promote 需要人工验证，不能自动化。
- **不做 TLS**：当前内网部署，不走 HTTPS。上线公网时需额外配置反向代理。
- **不做跨机部署**：两个容器同宿主机，共享 Docker named volume。
