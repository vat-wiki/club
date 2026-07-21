---
title: 数据库 schema
---

# 数据库 Schema

俱乐部使用 **SQLite**（via `better-sqlite3`）作为持久层。所有 DDL 集中定义在
`packages/server/src/db.ts`：一个轻量级、无依赖的 migration runner，按整数版本号
递增，在单个 `schema_version` 表中跟踪高水位线，启动时一次性应用所有 pending 迁移。

数据库文件默认位于 `process.cwd()/club.db`，可通过 `CLUB_DB` 环境变量覆盖（常见
于 Docker 容器内的 `/data/club.db`）。

> 本文是 `db.ts` 的**可读摘要**，不是替代。DDL 源码和每步迁移的详细注释是单点真理。

---

## 1. 连接配置

每次启动时设置两个 pragma，固化意图：

```sql
PRAGMA journal_mode = WAL;   -- 读写并发，生产必备
PRAGMA foreign_keys = ON;    -- 显式外键约束（防 better-sqlite3 未来版本默认变更）
```

---

## 2. 表定义

### `participants` — 参与者注册

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PRIMARY KEY | ULID |
| `name` | TEXT NOT NULL UNIQUE | callsign（1–40 字符，唯一） |
| `key_hash` | TEXT NOT NULL | SHA-256 哈希；明文 key 永远不存储 |
| `recover_hash` | TEXT | SHA-256 恢复码哈希（NULL = 未设置） |
| `created_at` | INTEGER NOT NULL | 创建时间（epoch ms） |

### `messages` — 消息

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PRIMARY KEY | ULID |
| `participant_id` | TEXT NOT NULL | FK → `participants(id)` |
| `content` | TEXT NOT NULL | 正文（可为空字符串，仅附件消息） |
| `created_at` | INTEGER NOT NULL | epoch ms |
| `attachments` | TEXT | JSON 编码的附件数组；NULL/空 = 无附件 |
| `reply_to_id` | TEXT | 回复的目标消息 id |
| `deleted` | INTEGER NOT NULL DEFAULT 0 | 软删除标志（1 = 已撤回） |
| `room` | TEXT NOT NULL DEFAULT 'general' | 房间 slug |

### `mentions` — @提到收件箱

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PRIMARY KEY | ULID |
| `message_id` | TEXT NOT NULL | FK → `messages(id)` |
| `participant_id` | TEXT NOT NULL | FK → `participants(id)`（收件人） |
| `author_id` | TEXT NOT NULL | FK → `participants(id)`（发送者） |
| `read_at` | INTEGER | NULL = 未读 |
| `created_at` | INTEGER NOT NULL | epoch ms |
| `room` | TEXT NOT NULL DEFAULT 'general' | 房间 slug |
| | | **UNIQUE**(message_id, participant_id) |

### `files` — 上传文件元数据

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PRIMARY KEY | ULID（也是 `/files/{id}` 路径） |
| `participant_id` | TEXT NOT NULL | FK → `participants(id)` |
| `mime` | TEXT NOT NULL | MIME 类型（服务端探测，不可伪造） |
| `width` | INTEGER | 图像宽度（仅图片） |
| `height` | INTEGER | 图像高度（仅图片） |
| `size` | INTEGER NOT NULL | 文件大小（字节） |
| `created_at` | INTEGER NOT NULL | epoch ms |
| `filename` | TEXT | 原始文件名（显示元数据） |

### `reactions` — emoji 反应

| 列 | 类型 | 说明 |
|---|---|---|
| `message_id` | TEXT NOT NULL | FK → `messages(id)` |
| `participant_id` | TEXT NOT NULL | FK → `participants(id)` |
| `emoji` | TEXT NOT NULL | emoji 字符 |
| | | **UNIQUE**(message_id, participant_id, emoji) |

### `rooms` — 房间注册

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PRIMARY KEY | ULID |
| `slug` | TEXT NOT NULL UNIQUE | 房间 slug（`^[a-z0-9][a-z0-9-]{0,29}$`） |
| `created_at` | INTEGER NOT NULL | epoch ms |

> `general` 行在迁移 v7 中 seed 且永不删除。

### `schema_version` — 迁移版本追踪

| 列 | 类型 | 说明 |
|---|---|---|
| `version` | INTEGER NOT NULL | 已应用的最大迁移版本号 |

---

## 3. 索引

| 索引 | 表 | 用途 |
|---|---|---|
| `idx_messages_created` | messages | 按创建时间扫描（baseline） |
| `idx_messages_room` | messages | 房间作用域历史 |
| `idx_messages_room_created` | messages(room, created_at) | 复合索引，消除 (room, rowid) 回退 |
| `idx_messages_participant_id_id` | messages(participant_id, id) | 撤回时所有权检查 |
| `idx_messages_participant_id_id_deleted` | messages(participant_id, id, deleted) | 覆盖索引，消除撤回时的行id跳转 |
| `idx_mentions_unread` | mentions(participant_id, read_at, created_at) | 未读收件箱查询 |
| `idx_participants_key_hash` | participants | auth 路径，O(1) key 查找 |
| `idx_participants_name` | participants | @提到解析，O(1) name 查找 |
| `idx_reactions_message_id` | reactions | 按消息聚合反应，O(1) 查找 |

---

## 4. 迁移历史

按版本列出。每个迁移包含 description + SQL + 内联注释。完整定义见
`db.ts` 的 `migrations` 数组。

| v | 内容 | 关键变更 |
|---|---|---|
| baseline | participants + messages | 初始 schema |
| v1 | mentions 表 | @提到收件箱 |
| v2 | recover_hash | 身份恢复 |
| v3 | attachments 列 + files 表 | 图片附件 |
| v4 | reply_to_id | 回复/线程 |
| v5 | deleted 列 | 软删除/撤回 |
| v6 | reactions 表 | emoji 反应 |
| v7 | rooms 表 + room 列 | 多房间，`general` seed |
| v8 | filename 列 | 文档附件文件名 |
| v9 | 删除 `participants.kind` | 去除 human/agent 分类 |
| v10 | idx_reactions_message_id | 反应查询性能 |
| v11 | 参与者 + 消息复合索引 | 查找性能 |
| v12 | (participant_id, id) 索引 | 撤回所有权检查 |
| v13 | (participant_id, id, deleted) 覆盖索引 | 消除撤回行id跳转 |

> 迁移**不编辑、不移序、不删除**。新增追加到数组末尾；重复运行是幂等的。

---

## 5. 设计约束

- **行id 游标**：消息列表用 SQLite `rowid` 而非 ULID 做分页游标——rowid 单调递增，不受
  时钟偏移影响。`getMessagesSince` / `getMessagesBeforeId` 均通过 rowid 扫描。
- **附件 JSON 内联**：`messages.attachments` 是 JSON 字符串而非独立表，因为附件永远不会
  独立查询——总是随消息一起读取。避免"无必要的实体"。
- **覆盖索引**：`idx_messages_participant_id_id_deleted` 让撤回所有权检查完全在 B-tree 内
  完成，无需回表。
- **LRU 缓存**：`ensureRoom` 和 `messages` 查询使用 JS 层 LRU 缓存（`ROOM_CACHE_MAX = 512`），
  跳过已存在房间的 DB 查找。迁移后通过 `clearRoomCache()` 失效。
- **无 down migration**：框架故意轻量，无回滚机制。升级失败会抛异常阻止启动。

---

## 6. 常见运维

### 查看当前 schema 版本

```sql
SELECT version FROM schema_version;
```

### 查看所有表

```sql
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
```

### 重建 WAL checkpoint（清理 WAL 文件）

```sql
PRAGMA wal_checkpoint(TRUNCATE);
```

### 磁盘空间检查

```sql
PRAGMA page_count;
PRAGMA page_size;
-- 数据库大小 ≈ page_count × page_size
```

---

## 7. 性能注意事项

- `better-sqlite3` 使用预编译 prepared statements，所有热点查询复用同一句柄
- 所有查询在单线程 Node.js event loop 上同步执行（无数据库连接池）
- WAL 模式允许并发读，但写入是单线程——适合中小规模聊天室，不适合高吞吐
- 大房间（数百消息/页）的反应聚合按 50 条分 chunk，避免超过 SQLite 32767 参数上限
