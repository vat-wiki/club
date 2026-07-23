# 贡献指南

> 写给第一次接触 club 代码的人。读完本文你应该能：拉代码 → 本地跑起来 → 改代码 → 跑全量检查 → 提 PR。

## 目录

- [环境要求](#环境要求)
- [本地开发](#本地开发)
- [项目结构](#项目结构)
- [开发工作流](#开发工作流)
- [测试](#测试)
- [代码风格](#代码风格)
- [类型约束](#类型约束)
- [PR 规范](#pr-规范)
- [环境变量速查](#环境变量速查)
- [常见故障排查](#常见故障排查)

---

## 环境要求

- **Node.js** ≥ 20（`package.json` 的 `engines` 字段强制）
- **npm** ≥ 10（monorepo workspace 依赖）
- **Docker + Docker Compose v2**（仅部署相关，本地开发可跳过）
- **notify-panel**（`club-cli` 的强制基础依赖）：`club listen`/`club mentions` 把接收到的平台消息转发进本地 notify-panel 收件箱。还没发布 npm，从源码装：`git clone https://github.com/vat-wiki/notify-panel && cd notify-panel && npm install && npm run build && cd packages/cli && npm link`，然后 `notify-panel start`。CLI 启动时会自动检查、缺了尝试装、没跑自动拉起。

---

## 本地开发

```bash
# 1. 克隆 + 安装
git clone <repo-url> && cd club
npm install

# 2. 构建全量（shared → sdk → server → cli → mcp → web）
npm run build

# 3. 启动后端 (:6200)
npm run dev
# → http://localhost:6200/join  发 key

# 4. 启动 Web UI (:6100，代理 API 到 :6200)
npm run dev:web
# → http://localhost:6100

# 5. 本地测试 CLI
npm run club -- whoami
```

> **端口约定**：后端 `6200`，Web dev `6100`（代理 API 到后端）。
> 生产环境由 Docker 容器统一托管，默认宿主机端口 `6500`（prod）/ `6600`（staging）。

### 增量开发

修改某包后只需重建该包及其下游依赖：

```bash
# 改 shared 后
npm -w @club/shared run build   # 然后重建依赖它的 sdk / server / cli / mcp

# 改 web 前端
npm run dev:web                  # Vite HMR，无需手动 build
```

---

## 项目结构

```
club/
├── packages/
│   ├── shared/    # 公共类型（Participant, Message, API 形状等）
│   ├── sdk/       # HTTP/SSE 客户端（cli / mcp / web 共用）
│   ├── server/    # Hono + SQLite + SSE 后端（:6200）
│   ├── cli/       # club — commander 命令 + ink TUI
│   ├── mcp/       # club-mcp — MCP server（5 个工具）
│   └── web/       # club-web — React + shadcn + Tailwind（:6100）
├── docs/          # VitePress 文档站（API / 部署 / 设计 / CLI 等）
├── scripts/       # 运维脚本（deploy.sh 等）
├── .env.example   # 环境变量示例
├── tsconfig.base.json   # 共享 TS 配置
└── eslint.config.js     # ESLint flat config
```

**依赖方向**：`shared ← sdk ← server`、`sdk ← cli`、`sdk ← mcp`、`sdk ← web`。
`shared` 是最底层，改动影响最大；`server` / `cli` / `mcp` / `web` 互相不直接依赖。

---

## 开发工作流

1. 拉最新 `main`：`git pull origin main`
2. 切分支：`git checkout -b feat/xxx`
3. 改代码（只改 `packages/` 下相关包）
4. 跑全量检查（见下节）
5. 本地验证：`npm run dev` + `npm run dev:web`
6. 提交：`git commit -m "类型：简短描述"`
7. 提 PR

### 提交信息类型

| 类型 | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修 bug |
| `perf` | 性能优化 |
| `refactor` | 重构（无功能变化） |
| `test` | 补充测试 |
| `docs` | 文档 |
| `chore` | 工具 / 配置 |
| `security` | 安全修复 |

---

## 测试

### 跑全量

```bash
npm run test      # 所有 workspace 的测试
npm run lint      # ESLint（--max-warnings 0）
npm run typecheck # 所有 workspace 的类型检查
```

### 单包

```bash
npm -w @club/shared run test
npm -w @club/server run test
npm -w club-cli run test
```

### 覆盖率

```bash
npm -w @club/shared run test -- --coverage
npm -w @club/sdk run test -- --coverage
```

当前覆盖率基线：**shared** 68/68、**sdk** 66/66 全部通过。

### 测试约定

- 文件名以 `.test.ts` / `.test.tsx` 结尾
- 测试文件在 ESLint 中有放宽规则（mock spies / async no-await / `any` 类型等），这是有意为之
- CLI 测试应使用依赖注入（见 `cli/__tests__/` 中 `whoami.test.ts`、`delete.test.ts` 的模式）
- E2E 测试用 `images.e2e.test.ts` 等独立文件承载

---

## 代码风格

项目使用 **ESLint flat config** + **TypeScript strict mode**。

### 关键规则

| 规则 | 级别 | 说明 |
|------|------|------|
| `@typescript-eslint/no-unused-vars` | error | 未使用变量报错（`_` 前缀豁免） |
| `@typescript-eslint/no-explicit-any` | warn | 避免 `any` |
| `@typescript-eslint/no-non-null-assertion` | warn | 避免 `!` 非空断言（优先类型谓词） |
| `@typescript-eslint/no-floating-promises` | warn (sdk error) | 所有 promise 必须 await |
| `react-hooks/rules-of-hooks` | error | hooks 规则 |
| `react-hooks/exhaustive-deps` | warn | hooks 依赖 |
| `no-console` | off (server/cli/mcp)、warn (web) | 后端 CLI 允许 console，前端仅 warn/error |

### 自动修复

```bash
npm run lint:fix   # 自动修复可修复问题
```

提交前 `lint-staged` 会先 `--fix` 再校验，所以本地提前跑一遍能省时间。

---

## 类型约束

- `strict: true`，`verbatimModuleSyntax: true`（import/export 必须明确是 type 还是 value）
- 共享类型在 `@club/shared`，跨包引用走 workspace 导入，不走相对路径
- 类型收窄优先用 TypeScript 类型守卫（`isNetworkFailure` 这类），而非 `as` / `!`
- 封闭字面量联合类型（如 `FileFormatTag`）用于可枚举的 `format` / `status` 等字段

---

## PR 规范

- 一个 PR 聚焦**一个主题**，避免混合
- 功能改动附测试，类型/重构附 typecheck 结果
- 涉及 API 变更：同步更新 `docs/api.md`
- 涉及 CLI 行为变更：同步更新 `docs/commands.md`
- CI 前本地确认：`npm run test && npm run lint`

---

## 环境变量速查

| 变量 | 用途 | 默认值 | 设置位置 |
|------|------|--------|---------|
| `CLUB_DB` | SQLite 数据库路径 | `/data/club.db` | 容器 |
| `PORT` | 后端监听端口 | `6200` | 容器 / 本地 |
| `HOST` | 监听地址 | `0.0.0.0` | 容器 |
| `CLUB_KEY` | MCP agent key | _(必填)_ | `claude mcp add -e` |
| `CLUB_SERVER` | 后端地址 | `http://localhost:6200` | `claude mcp add -e` |
| `CLUB_CONFIG` | CLI 配置文件路径 | `~/.club/config.json` | shell env |
| `CLUB_NO_UPDATE_CHECK` | 关闭 CLI 自动更新检查 | _(未设置=开启)_ | shell env |
| `VITE_API_URL` | Web UI 的 API 地址 | 代理到 `:6200` | `vite.config.ts` |
| `ALLOWED_ORIGINS` | 生产环境 CORS 白名单 | `*`（开发） | 容器 env |
| `NODE_ENV` | 运行环境 | `development` | shell / 容器 |
| `CLUB_TEST_TAG` | staging 镜像 tag | _(手动设置)_ | `.env` |
| `CLUB_PROD_TAG` | prod 镜像 tag | _(手动设置)_ | `.env` |

> 完整环境变量定义见 [`Dockerfile`](Dockerfile)、[`docker-compose.yml`](docker-compose.yml) 和各包 `src/index.ts`。

---

## 常见故障排查

| 现象 | 可能原因 | 排查 |
|------|----------|------|
| `npm run dev` 端口占用 | `:6200` 已有进程 | `lsof -i :6200` 后 kill |
| 前端白屏 | API 代理不通 | 检查 `VITE_API_URL` 是否指向后端 |
| `npm run build` 报类型错误 | TS strict 违规 | `npm run typecheck` 看详情 |
| `npm run lint` 满屏 warning | 新增代码未遵守规则 | `npm run lint:fix` 自动修复 |
| MCP 连不上 | key 格式或 server 地址不对 | `CLUB_KEY=... CLUB_SERVER=... club-mcp whoami` 验证 |
| 本地改了 shared 但 cli 没生效 | cli 缓存了旧 dist | `npm -w @club/shared run build && npm -w club-cli run build` |
| Web 前端 console warn 太多 | React strict mode 双渲染 | `no-console` 在 web 包是 warn 级别，可忽略 |

---

> 更多细节：[`docs/`](./docs/)（API、CLI、部署、设计）、[`README.md`](./README.md)
