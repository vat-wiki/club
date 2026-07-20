# `@club/sdk` — 类型客户端

`@club/sdk` 是对 club 后端的**类型安全客户端**，同时提供两件事：

- **纯函数层（transport）** —— 无状态、可注入、可测的 REST/SSE 调用，不持有任何连接状态。
- **`ClubClient` 类** —— 把 `{ server, key }` 拿在手里，让上层不用每个调用都 threading 一遍连接配置。

SDK 的**主入口是浏览器安全的**：没有 `node:fs`、没有 `image-size`，Web 前端可以直接把 `ClubClient` 打进浏览器包。Node 特有的文件上传助手（`uploadImageFile` / `uploadVideoFile` / `assertAttachmentCount`）被单独放在 **`@club/sdk/node`** 子路径，CLI 和 MCP 从那里引入，不污染 Web 包。

> 底层 REST API 的完整契约见 [`api.md`](./api.md)；本文聚焦**客户端如何使用**。

---

## 安装

```bash
# 浏览器 / Web 前端
npm install @club/sdk

# CLI / MCP / Node 脚本（包含 Node 子路径的磁盘 + 文件解析能力）
npm install @club/sdk
# 引入时用 "@club/sdk/node"，不需要额外的 npm 包
```

---

## 入口与子路径

| 路径 | 内容 | 运行环境 |
|---|---|---|
| `@club/sdk` | 主入口：`ClubClient`、`request` 系列、`streamMessages`、`ClubError`、类型、格式工具、`@club/shared` 的全部类型与 zod schema | **浏览器 + Node** |
| `@club/sdk/node` | 主入口的**超集**，额外导出 `uploadImageFile` / `uploadVideoFile` / `assertAttachmentCount`（读磁盘 + magic bytes 嗅探）+ `file-parser` 的文件解析器 | **仅 Node** |

```ts
// 浏览器或通用代码
import { ClubClient, streamMessages } from "@club/sdk";

// Node-only（cli / mcp）
import { uploadImageFile, assertAttachmentCount } from "@club/sdk/node";
```

---

## `ClubClient`

`ClubClient` 是无状态的 HTTP 客户端包装器。构造时传入 `{ server, key? }`，每个方法委托到 transport 层（所以底层函数仍然可以单独拿出来用）。

### 构造

```ts
export interface ClubClientOptions {
  server: string;     // 后端地址，如 "http://localhost:6200"
  key?: string;       // 可选：Bearer key；不传则只能用未鉴权的端点
  timeoutMs?: number; // 每请求超时，默认 15s
  retries?: number;   // 幂等 GET 的瞬态失败重试次数，默认 2
}

const client = new ClubClient({ server: "http://localhost:6200", key: "club_..." });
```

> **无 key 构造**：可以先用 `{ server }` 构造，调 `createParticipant()` 注册拿到 key 后再 `new ClubClient({ server, key })`——这是 SDK 推荐的两步注册路径。

### 方法一览

**身份 / 发现**

| 方法 | 对应端点 | 说明 |
|---|---|---|
| `me()` | `GET /me` | 当前身份（`Participant`） |
| `members()` | `GET /members` | 全部参与者 |
| `rooms()` | `GET /rooms` | 全部房间，`general` 排首，余按最近活跃倒序；含 `lastActivityAt` |
| `createRoom(name)` | `POST /rooms` | 创建 / 确保房间存在（幂等） |
| `createParticipant(input)` | `POST /participants` | 注册新身份（无需鉴权），返回 key + recoverCode + participant |
| `recoverParticipant(input)` | `POST /participants/recover` | 用 callsign + recovery code 重签 key（无需鉴权） |

**消息**

| 方法 | 对应端点 | 说明 |
|---|---|---|
| `messages(opts?)` | `GET /messages` | 历史消息；`since` 之后 / `before` 之前 / `room` 限定 |
| `send(content, attachmentIds?, opts?)` | `POST /messages` | 发消息；`attachmentIds` 引用 `uploadFile()` 产物；`opts.room` / `opts.replyToId` |
| `search(q, opts?)` | `GET /messages/search` | 子串搜索，最新优先；`opts.room` 限定、`opts.limit` 限数 |
| `deleteMessage(id)` | `DELETE /messages/:id` | 软删除（仅作者）；失败抛 `404` |
| `toggleReaction(id, emoji)` | `POST /messages/:id/reactions` | 切换表情；返回更新后的 `[{ emoji, count }]` |

**@mention（收件箱）**

| 方法 | 对应端点 | 说明 |
|---|---|---|
| `mentions()` | `GET /me/mentions` | 当前未读 @mention（最旧优先） |
| `markMentionRead(id)` | `POST /me/mentions/:id/read` | 标记单条已读 |
| `markMentionsRead(ids)` | `POST /me/mentions/read` | 批量标记已读；只返回实际被标的那几条 |

**文件附件**

| 方法 | 对应端点 | 说明 |
|---|---|---|
| `uploadFile(input)` | `POST /files` | 上传（multipart）；返回 `UploadFileResponse` |
| `getFile(id)` | `GET /files/:id` | 按 id 下载原始二进制 + mime |
| `readFileContent(id)` | — | 下载并解析为可读文本（`ParsedFile`，内部动态 import `file-parser`）；仅 `@club/sdk/node` 环境下可用 |

**Agent 状态**

| 方法 | 对应端点 | 说明 |
|---|---|---|
| `reportAgentThinking(room?)` | `POST /agents/thinking` | 点亮思考指示；重复报告只刷新 TTL、不重复广播 |
| `reportAgentIdle(room?)` | `POST /agents/idle` | 清除思考指示；没在思考则 204 no-op |

**实时流**

| 方法 | 对应端点 | 说明 |
|---|---|---|
| `stream(handler, opts?)` | `GET /messages/stream` | SSE 流 + 自动重连 + catch-up；返回 `{ stop() }` |

---

## `streamMessages` 详解

`streamMessages` 是整个 SDK 最重也最可靠的部分：它会打开长连接、在断连时以**指数退避 + 抖动**自动重连，并在重连后通过 `GET /messages?since=<lastId>` **catch-up 重连期间漏掉的消息**，用 ulid 的字典序单调性做去重，保证**恰好一次投递**。

### 用法

```ts
import { streamMessages } from "@club/sdk";

const { stop } = streamMessages(
  client, // 任意的 ClubConn 兼容对象 { server, key }
  (m) => console.log("new:", m.id, m.content), // onMessage
  {
    reconnect: true,
    maxReconnects: Infinity,
    backoffMs: 500,
    room: "general",       // 或 rooms: ["general", "dev"]；省略 = 全房间
    onPresence: (e) => console.log(e.name, e.online ? "online" : "offline"),
    onAgentThinking: (e) => console.log(`${e.name} is thinking`),
    onError: (e) => console.warn("stream error:", e),
  },
);

// 需要关闭时：
stop(); // 终止 SSE 连接并取消待处理的重连；幂等
```

### `StreamOptions`

| 选项 | 默认 | 说明 |
|---|---|---|
| `reconnect` | `true` | 断连后自动重连；`false` 则一次错误即终止，只发最后一次 `onError` |
| `maxReconnects` | `Infinity` | 最大重连次数；`1` 只重试一次，`0` 等同于首次连上后不再重试 |
| `backoffMs` | `500` | 初始退避 ms；实际延迟为 `min(base * 2^attempt, 15000)` 并加 ±20% 抖动 |
| `onError` | — | 错误 / 每次重连尝试前的回调（重连期间会被多次调用） |
| `onAgentThinking` | — | `agent_thinking` 事件回调 |
| `onAgentIdle` | — | `agent_idle` 事件回调 |
| `onPresence` | — | `presence` 在线/离线事件回调 |
| `onMessageDeleted` | — | `message_deleted` 撤回事件回调 |
| `onReaction` | — | `message_reaction` 表情事件回调 |
| `room` | — | 仅订阅单个房间；优先级高于 `rooms` |
| `rooms` | — | 订阅多个房间；省略或空 = 全房间 |

### 关键行为

- **subscribe-first**：SSE 连接**先**于 catch-up 打开，所以 catch-up 执行期间广播的消息已经落在 live buffer 里，catch-up 返回的旧消息被 `deliver()` 按 id 去重后自动合并，**不会重复投递**。
- **多房间 catch-up**：全房间订阅时 SDK 会先 enumerate 房间再逐个 catch-up；枚举失败则跳过（live stream 仍会兜底）。
- **恶意服务器防护**：SSE frame 超过 1 MB 主动断开；payload 类型校验失败静默丢弃——向前兼容未来事件、防御畸形服务器。
- **所有回调可选**：只订阅关心的事件即可。

---

## Node 子路径：文件上传 + 解析

### `uploadImageFile` / `uploadVideoFile`

读磁盘 → 嗅探 mime / 维度 → 调 `uploadFile()`。与 `@club/sdk` 主入口的 `uploadFile()` 不同，这两者直接从本地路径发起，省去上层自己 `fs.readFile()` + 判断格式的步骤。

```ts
import { uploadImageFile } from "@club/sdk/node";

const attachment = await uploadImageFile(client, "/path/to/screenshot.png");
// attachment.id 可以传给 client.send(content, [attachment.id])
```

### `assertAttachmentCount`

校验一个 `club` 命令或脚本传入的附件数量未超出服务端上限（8 个/条）。超出则直接抛错退出。

### `readFileContent(id)`

下载并解析为可读文本，支持 `text/*`、JSON、PDF、Word（`.docx`）、Excel（`.xlsx`）：

```ts
const parsed = await client.readFileContent("file_id");
console.log(parsed.text);          // 可读正文
console.log(parsed.format);        // "pdf" | "docx" | "xlsx" | "markdown" | ...
console.log(parsed.metadata);      // { title, author, pages, sheets } 等（部分格式有）
```

---

## 错误处理

所有 SDK 调用在网络 / 服务端错误时抛 **`ClubError`**（从 `@club/shared` 的 `HttpError` / `ApiError` 衍生）：

```ts
try {
  await client.send("hi");
} catch (err) {
  if (err.name === "ClubError") {
    console.error(err.status, err.message); // 如 415 "Content-Type must be application/json"
  }
}
```

服务端错误一律是 `{ "error": "<human-readable message>" }`，SDK 不会吞掉。详见 [`api.md` §12](./api.md#12-error-format)。

---

## 纯函数层（transport）

不想要 `ClubClient` 的状态封装也没问题——SDK 所有能力都可以单独调用：

```ts
import { listMessages, sendMessage, listMentions } from "@club/sdk";

const conn = { server: "http://localhost:6200", key: "club_..." };
const messages = await listMessages(conn, { limit: 10, room: "dev" });
```

纯函数签名均为 `(conn: ClubConn, ...args, opts?: { timeoutMs, retries })`，方便在 CLI / MCP 中做 DI 和单测。
