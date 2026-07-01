# 图片输入 · 统一实现方案（综合产品 / 设计 / 体验）

> 三方输入见：`requirements/image-input.md`（产品 PRD）、`design-image-input.md`（设计稿）、
> 本环境体验取证（王体验报告，未落文档）。本文件是协调者汇总后的**唯一施工依据**，
> 供王前端 / 王后端并行实现。

## 0. 目标与范围

让 club 聊天输入框支持**图片输入**：粘贴 / 拖拽 / 点 attach 三入口，预览后与文字同条发送，
消息流里可看可放大。最小路径 = **2 步**：① 把图弄进输入框 ② 回车。

**MVP 关键决策（产品拍板，协调者确认）**
- 图片是「可共享/可展示的消息载体」，**对称于人 / agent**（同一套历史）。
- **MVP 不做**「图片作为 agent 多模态推理输入」——那是独立大特性。但附件用结构化字段，
  未来要「让 agent 看见」时契约不返工。
- **三端互相可见是硬约束**：不能出现「Web 能发图、CLI/MCP 看不见」的断层。

**范围**
- In：后端上传 API + 存储 + 契约扩展；Web 三入口 + 预览 + 发送 + 渲染 + lightbox + i18n + a11y；
  CLI/MCP **渲染**图片消息为 `[图片: url]`（满足互相可见）。
- Out：视频/音频/文件、图片编辑、OCR、agent 真看图、图片加密、消息撤回（列为紧随 P1）。
- 后置（Phase B，本批次不做）：CLI `--image` / MCP `images` **发送**图片、消息撤回、对象存储迁移。

## 1. 协调者对「文本是否必填」的裁决 ⚠️

- 产品初稿：`content` 仍必填（min 1）。
- 体验：P0 认为「有图无文也应允许发送」——纯截图是最常见意图，强制文字=加摩擦。

**裁决：采用体验方案，文本可选。** 发送条件 = `content.trim()` **或** `attachments.length > 0`。
理由：本次任务的头条目标就是「输入摩擦最小」，纯截图是最主流场景；产品担心的三端对等
已被覆盖——空文本 + 图片的消息，CLI/MCP 渲染为 `[图片: url]`，契约兼容旧客户端。
（若要否决此裁决，只需把 schema 改回 `min(1)` 并在 Web 禁止纯图发送。）

## 2. 数据契约（已由协调者写入 `packages/shared/src/types.ts`，前后端共用，勿重复定义）

```ts
export const ImageMime = z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export interface MessageAttachment {
  id: string;          // 服务端生成的不可猜测随机 slug，同时是 /files/{id} 的公开路径
  url: string;         // 根相对路径，如 "/files/{id}"，由各客户端拼自家 server origin
  mime: ImageMime;
  width?: number;      // px，便于加载前占位布局
  height?: number;
  size: number;        // bytes
}
// Message 增字段：
//   attachments?: MessageAttachment[]   // 缺省/空 = 纯文本消息（向后兼容）

export const MAX_MESSAGE_CONTENT = 4000;
export const MAX_IMAGES_PER_MESSAGE = 8;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// POST /messages：content 可选（见 §1 裁决）；跨字段「content 或 attachmentIds 至少一个」
// 由路由层 enforce，schema 只做单字段约束。
export const CreateMessageRequest = z.object({
  content:       z.string().max(MAX_MESSAGE_CONTENT).default(""),
  attachmentIds: z.array(z.string().min(1).max(64)).max(MAX_IMAGES_PER_MESSAGE).default([]),
});
// POST /files -> MessageAttachment（服务端是 mime/width/height/size 的唯一真源）
```

**限制常量（FE/BE 必须一致）**：mime 白名单 = png/jpeg/gif/webp；单图 ≤ 10MB；单消息 ≤ 8 图；文本 ≤ 4000。

## 3. 图片鉴权（已裁决）

- **上传 `POST /files` 需鉴权**（`requireAuth`，只有成员能传）。
- **服务 `GET /files/{id}` 免鉴权**。原因：`<img src>` 无法带 `Authorization` 头，
  而 club 是单房间、历史全员可见，不可猜测 id 已足够。上传方仍受控。
- 轶事：`GET /files/{id}` 应设缓存头（`Cache-Control: public, max-age=...`，id 不可变）。
- P2 演进：签名 URL / 鉴权服务 / 对象存储。

## 4. 后端实现（王后端）—— 契约已在 §2，**勿改 types.ts**，需要改找协调者

- **迁移 v2**（追加到 `db.ts` 的 `migrations` 数组，沿用现有 runner）：
  - `ALTER TABLE messages ADD COLUMN attachments TEXT;`（JSON 字符串，NULL/空=无图；选 JSON 列
    而非新表，遵循「若无必要无增实体」——附件无需独立查询；`toMessage` 解析即可）。
  - `CREATE TABLE files (id TEXT PRIMARY KEY, participant_id TEXT NOT NULL, mime TEXT NOT NULL,
    width INTEGER, height INTEGER, size INTEGER NOT NULL, created_at INTEGER NOT NULL);`
    ——上传元数据登记；消息发送时按 id 回查，服务端重建 attachments（防客户端伪造尺寸）。
- **`POST /files`**（multipart，字段名 `file`）：`requireAuth`；校验 mime∈白名单、size≤10MB；
  读首字节得 width/height（建议 `image-size` 纯 JS 包，无原生依赖）；写盘到存储目录
  （`process.env.CLUB_FILES ?? resolve(cwd,'files')`，存储路径抽象成函数，便于日后换对象存储）；
  id 用 `crypto.randomBytes(16).toString('base64url')`；插入 files 行；返回 `MessageAttachment`
  （`url: '/files/'+id`）。
- **`GET /files/:id`**：**不加 `requireAuth`**；按 id 读 files 行拿 mime，stream 文件，
  `Content-Type` 用 mime，设 `Cache-Control: public, immutable, max-age=31536000`；404 兜底。
- **`POST /messages`** 改造：解析新 schema；enforce `content.trim() || attachmentIds.length`；
  按 attachmentIds 查 files 行、校验归属本 participant、按数组顺序组装 `MessageAttachment[]`；
  `insertMessage(...)` 带上 attachments（JSON）；`broadcast` 的消息对象带 `attachments`。
- **`db.ts`**：`insertMessage` 增 `attachments` 参数；`toMessage`/读路径解析 JSON 列
  （`recentStmt`/`afterStmt` 都是显式列 SELECT，需在列清单加 `m.attachments`）。
- **CLI/MCP 渲染对等**：SDK/cli/mcp 展示消息时，若有 `attachments`，追加 `[图片: url]`
  （产品 §AC-6）。本批次只做「能看见」，发送留 Phase B。

## 5. 前端实现（王前端）—— 设计稿见 `design-image-input.md`，体验规格见王体验报告

- **Composer**（`packages/web/src/components/composer.tsx`）：
  - 最左加 `Paperclip` ghost 按钮（**不上 mint**，保住 Send 的独家信号），触发隐藏
    `<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple capture>`。
  - textarea 容器：`onPaste` 拦截 `clipboardData.items` 里的 `file/image/*`（`preventDefault`）；
    纯文本粘贴放行默认行为。
  - 容器：`onDragOver preventDefault` + `onDrop` 收 `dataTransfer.files` 里的图片、吞默认
    （**王体验取证：默认行为会把图片当 URL 打开、整页替换、把人踢出房间——必须先拦**）。
  - 本地态 `attachments: {key, file, objectUrl, status: 'uploading'|'done'|'error', remote?: MessageAttachment}[]`；
    选入即上传（`POST /files`），缩略图行（64px `rounded-md` `border-border`，右上 × 删除 44×44，
    上传中叠 mint 2px 进度 + `Loader2`，失败叠 destructive + 重试）。
  - 发送：`onSend(content, attachments)` —— **文字+图片同一条**；有图无文也允许；
    任一 uploading 时 Send 禁用并提示「图片上传中…」；发送后 `revokeObjectURL` 防泄漏。
- **本地校验（P1，但建议 MVP 就做）**：mime 白名单 / 10MB；超限 toast 带**具体数字**
  （`图片不能超过 10MB（这张 24MB）`）。i18n key 加到 `packages/web/src/lib/i18n.tsx`。
- **Message list**（`message-list.tsx`）：渲染 `attachments`——缩略图 `max-w-320 aspect-[4/3]
  rounded-md`（比气泡 `rounded-lg` 小一级），多图 `grid-cols-2`；沿用 self/others 气泡底色。
  点击 → **复用 Radix Dialog 做 lightbox**（透明无边框 + `object-contain max-h-85vh`，
  已有 zoom-95/fade/300ms/out-quint，不自造）。
- **a11y（WCAG 2.1 AA）**：attach 按钮 `aria-label`；chip `role="img"` + `aria-label`
  （「图片 1，上传中 60%」）；删除按钮 `aria-label`；进度区 `aria-live="polite"`；44×44 触控；
  键盘用户走 attach 按钮等价路径。所有动效尊重 `prefers-reduced-motion`。
- **动效**：`shimmer` keyframe 设计已加进 `tailwind.config.ts`；chip 入场 `zoom-in-95 fade-in 200ms`
  + stagger 40ms，删除 `zoom-out-95 150ms`。

## 6. 验收要点（节选，完整 AC 见 PRD）

契约向后兼容（旧客户端无感）；上传鉴权 + mime/尺寸限制；三端互相可见（Web 发、CLI/MCP
回看带 `[图片: url]`）；空文本纯图可发；超大/错格式被拒并提示；上传失败可重试；现有测试全绿。

## 7. 环境备注

此前「后端起不来」为瞬态（`require('better-sqlite3')` 实测可加载）；王后端实现时确认 server 能 boot 即可。
