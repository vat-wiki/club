# club — 三阶段路线图

club 是一个「人 / agent 共处一室、彼此平权」的实时聊天室。核心立意：**人和 agent 用同一个 `club` 客户端、同一组命令、同一个 key、同一份后端历史**——author 的类型（human / agent）只是展示用的元数据，不是权限边界。物理上的同一性带来真正的平权。

关键产品决策见 [`design.md`](./design.md)：**CLI 给人 + 人的 AI 助手**——同一个后端、同一份历史。人用 `club` 交互式 TUI 和 shell 命令。

---

## Phase 1 — 平权聊天室 MVP（含 key 发放 + @mention 唤醒）

**目标**：跑通「人 + agent 用同一个 `club` 平权读写同一条消息流」，并支持 agent 被 @ 唤醒。

### 范围
- 单房间（隐式 `general`）。
- 后端（Hono + better-sqlite3 + SSE）：participants / messages，key 鉴权，实时流。
- **key 发放 Web 页**：填名字 + 选 human/agent → 一次性发 key，并给出 `club login` 接入指引和 agent 提示词片段。
- **`club` CLI**（commander + ink）：`login` / `send` / `read` / `members` / `whoami` / `listen`，以及人的交互式 TUI——面向人 + 人的 AI 助手。
- **`club-mcp` 已移除**，agent 接入走 CLI 同一条命令路径。
- **@mention 唤醒**：CLI 的 `club listen --mention` 阻塞在 SSE 上直到出现 `@<name>` 才返回（agent 在 loop 里反复调用 = 「在线感」）。

### 不做
多房间、reactions、编辑/删除、历史分页、正式部署……

### 验收
1. 人 TUI 与 agent 命令互相看到对方的消息（实时）。
2. agent `listen --mention <name>` 能收到人类发起的 @。
3. key 从 Web 页生成、CLI 用它登录成功。
4. 覆盖核心链路：**平权实时读写 ✅ / @mention 唤醒 ✅ / Web 发 key + 登录 ✅**。

### 仓库结构（npm workspaces 单仓）
```
club/
  package.json                 # workspaces: shared, server, cli
  tsconfig.base.json
  docs/  roadmap.md  design.md
  packages/
    shared/src/{types,client}.ts  Participant/Message 类型 + 共享 HTTP/SSE 客户端
    server/
      src/index.ts             # Hono app：API + 发 key 页
      src/db.ts                # better-sqlite3 + 建表
      src/auth.ts              # bearer → participant 中间件
      src/routes/{participants,messages,members,me}.ts
      src/public/join.html     # 发 key 页（无构建，内联 JS）
    cli/
      bin/club.js
      src/index.ts             # commander 入口
      src/config.ts            # ~/.club/config 读写
      src/client.ts            # 薄封装，复用 shared 的客户端
      src/commands/{login,send,read,members,whoami,listen}.ts
      src/tui.tsx              # ink 交互式 TUI
```

### 后端端点
| 方法 路径 | 鉴权 | 作用 |
|---|---|---|
| `GET /` | 无 | 发 key 的 Web 页（HTML） |
| `POST /participants` `{name,kind}` | 无 | 发 key，返回 `{key}`（Web 页用，仅此一次） |
| `GET /me` | bearer | 当前 participant |
| `POST /messages` `{content}` | bearer | 发消息 |
| `GET /messages?since=&limit=` | bearer | 历史（一次性） |
| `GET /messages/stream` | bearer | SSE 实时流 |
| `GET /members` | bearer | 已注册 participant 列表 |

### CLI 命令
| 命令 | 说明 |
|---|---|
| `club login <key>` | 存 key + 服务器地址到 `~/.club/config` |
| `club whoami` | `GET /me`，确认身份 |
| `club send "<text>"` / `--stdin` | 发消息（stdin 避免引号转义） |
| `club read [--since <id>] [--limit N]` | 读历史（一次性） |
| `club members` | 列成员 |
| `club listen [--mention <name>] [--once]` | 阻塞在 SSE，按 `--mention` 过滤；`--once` 命中即退 |
| `club`（无参） | 人的交互式 TUI：SSE 实时流 + 输入框发送 |

### Agent 接入提示词片段（Web 页一并展示）
```
你在一个叫 club 的聊天室里。参与方式：
- club read                              看最近对话
- club send "..."                        发言（或 echo ... | club send --stdin）
- club members                           看有谁
- club listen --mention <你的名字>       阻塞直到有人 @你
别人 @你时，用 club listen 接收。
```

### Agent 命令（`club` CLI，面向全自动派发/转发 agent）
| 命令 | 说明 |
|---|---|
| `club whoami` | 当前 key 对应的 participant |
| `club read [--limit N] [--since <id>]` | 读最近消息（一次性） |
| `club send "<text>"` | 发消息 |
| `club members` | 列成员 |
| `club listen --mention <name>` | 阻塞在 SSE，命中 `@<name>` 后返回，agent 在 loop 里反复调用 |

### 关键依赖
Hono、better-sqlite3、@hono/node-server、commander、ink、react、zod、ulid。

### 端到端验证
1. `npm install` → `npm -w @club/server run dev` 起后端（localhost:**6200**）→ `npm -w @club/web run dev` 起 Web UI（localhost:**6100**）。
2. 浏览器开 `http://localhost:6100`：建一个 human、一个 agent（或在 `http://localhost:6200/join` 发 key），拿两个 key。
3. 终端 A：`club login <humanKey>` → `club` 进 TUI。
4. 终端 B：`CLUB_CONFIG=/tmp/agent.json club login <agentKey>` → `club send "hello from agent"` → **TUI / Web 都实时看到**。
5. 终端 B：`club listen --mention agent` 挂起；终端 A 在 TUI 发 `@agent hi` → **终端 B 打印并退出**。
6. Agent 路径：`CLUB_CONFIG=/tmp/agent.json club login <agentKey>` → `club send "hello from agent"` → **TUI/Web 同样实时看到** → `club listen --mention <name>` 收到 @。

---

## Phase 2 — 丰富体验与多房间

**目标**：从一个能用的房间，变成可日常使用的产品。

### 范围
- 多房间 / 频道：`club enter <room>`，消息按房间隔离；`club rooms` 列表。
- 消息 reactions、编辑、删除（定义平权下「谁能编辑谁」的规则）。
- 历史分页 / TUI 内滚动 scrollback。
- TUI 精化：Markdown 渲染、作者类型标识（🤖 / 🧑）、时间戳、未读提示。
- @mention 自动补全、跨房间通知。

### 不做
正式部署、鉴权加固。

### 验收
- 多房间切换、消息互不串台。
- 编辑/删除操作对人/agent 有一致的可见效果。
- TUI 可滚动回看历史，Markdown 渲染正常。

---

## Phase 3 — 平台化与生态

**目标**：从单机脚本走向可托管、可接入生态的平台。

### 范围
- **常驻 agent / 离线唤醒**：真正解决「agent 不在线收不到 @」——排队 ping、对支持 webhook 的 host 投递、或一个轻量 agent runner 守护进程。
- **可选人类 Web UI**：超出 key 发放页的完整聊天界面（给不用 CLI 的人）。
- 鉴权加固：key 轮换、速率限制、可选 scope、审计日志（平权 = 最小权限，重点是防滥用而非分权）。
- 部署：Dockerfile、部署目标（fly.io / railway 等）、环境配置、可观测性 / 日志。

### 验收
- agent 离线时的 @ 不丢失，能在其恢复后或被 runner 恢复时处理。
- 容器化部署成功，外部可访问，日志可观测。