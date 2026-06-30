# 图片输入 — 视觉与动效设计稿

> 设计 voice：好不好看、有没有品味。与体验稿（好不好用）互补。
> 基线：实地截图确认的 club 现有设计语言（深石墨灰 / mint=agent / amber=human / 克制 / 单容器输入条）。
> 涉及组件：`packages/web/src/components/composer.tsx`、`message-list.tsx`、`ui/dialog.tsx`。

---

## 0. 设计原则（先立规矩）

1. **图片不破坏「人机双色」灵魂**：图片本身是彩色内容，不再额外上色。容器一律走中性面（`bg-card` / `bg-chrome`），边框走 `border`。不在 chip/气泡上加 mint/amber 渐变——让双色继续只服务于 author 身份。
2. **图片是「内容」不是「装饰」**：在气泡里它和文字同级，吃同一套间距模数（4/8pt）、同一套圆角阶梯。
3. **动效服务注意力，不炫技**：所有过渡沿用项目已有的 easing `cubic-bezier(0.16,1,0.3,1)`（out-quint，Dialog 已用），不在图片上引入新曲线语言。
4. **图片静音背景**：上传中是唯一允许动起来的状态（进度），其余状态一律静态或单次入场。

---

## 1. Attach 入口（P0）

### 位置
```
┌──────────────────────────────────────────────────────┐
│  border-agent/50 (focus)                             │
│  ┌────────────────────────────────────────────┐      │
│  │ [📎]  在这里写消息…                    [Send]│  ← 单容器输入条 bg-card │
│  └────────────────────────────────────────────┘      │
│  Enter 发送 · shift+enter 换行                        │
└──────────────────────────────────────────────────────┘
```
- **attach 按钮放在输入条容器内部、textarea 左侧**，与 Send 按钮左右对称（容器是 `items-end gap-2.5`）。
- 现状 Send 按钮在右、textarea 在左。attach 放最左，顺序变为：`[attach] [textarea …] [Send]`。三者同属一个 `bg-card` 容器，读作「一条输入条的三段」，而不是浮在外面的工具。

### 长相（落到类名）
- 用 lucide `Paperclip`（与现有 lucide 图标库一致，stroke-width 全局统一为 1.5——与 Send 的 `h-4 w-4` 同尺寸）。
- 按钮：ghost 风，**与 textarea 同高**（`min-h-[48px] sm:min-h-[56px]`，复用 Composer 现有的同高策略），`px-2`，图标 `h-4 w-4 text-muted-foreground`。
- 交互态：`hover:text-foreground hover:bg-accent/60 transition-colors duration-150`；`focus-visible:ring-2 ring-ring`。
- **不**用 mint 给 attach 上色——mint 是「可发送」的品牌信号，attach 是中性工具，保持 muted 灰。这样 Send(mint) 与 attach(灰) 形成清晰的「主操作 vs 辅助操作」层级。
- 理由：现在 Send 的 mint 是「ready to send」的独家信号（代码注释 P2-2 明确）。给 attach 上 mint 会稀释这个信号。

### 隐藏 file input
- `<input type="file" accept="image/*" multiple hidden>`，attach 按钮 `onClick` 触发 `.click()`。同时支持**粘贴**（textarea `onPaste` 检测 `clipboardData.items` 的 image）和**拖拽**（输入条容器 `onDrop`）——这三个入口的视觉态见 §动效。

---

## 2. 输入框内的图片预览 chip（P0）

### 排布（选中后输入条变高）
```
┌──────────────────────────────────────────────────────┐
│  ┌────────────────────────────────────────────┐      │
│  │ [📎]  在这里写消息…                    [Send]│      │
│  │ ┌────────┐ ┌────────┐                       │      │
│  │ │  img   ×│ │  img   ×│                     │      │
│  │ │ ⬛⬛⬛⬛ │ │ ⬛⬛⬛⬛ │  ← chip 行            │      │
│  │ └────────┘ └────────┘                       │      │
│  └────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────┘
```
- chip 行位于 **textarea 下方、仍在输入条容器内部**（容器内从上到下：textarea → chip 行 → padding）。容器 `bg-card` + mint focus border 自然包住 chip，视觉一体。
- chip 容器：`flex flex-wrap gap-2 px-1 pt-1`（与容器 `p-0.5` 协调）。出现时把容器整体撑高，textarea 高度不变。

### 单个 chip 规格（落到 token）
| 属性 | 值 | 来源/理由 |
|---|---|---|
| 尺寸 | `h-16 w-16`（64px） | 缩略图，3 张以内一行；4+ 换行 |
| 圆角 | `rounded-md`（`--radius: 0.625rem` → 0.625rem） | 与输入条容器 `rounded-md` 同级，不引入新圆角 |
| 边框 | `border border-border`（L20%） | 项目标准分隔；上传中变 `border-agent/40` |
| 图片填充 | `object-cover` | 正方形缩略，避免变形 |
| 背景 | `bg-muted` | 图片加载前的占位面，与 token 体系一致 |
| 删除按钮 × | `absolute right-1 top-1`，`h-5 w-5 rounded-full bg-background/80 backdrop-blur-sm`，lucide `X` `h-3 w-3` | 半透明深底 + 模糊，叠在图右上角；hover `bg-background` |

### 状态变体
- **上传中**：chip 上叠 `absolute inset-0 grid place-items-center bg-background/60 backdrop-blur-[2px]`，中间一个 `Loader2` `h-4 w-4 animate-spin text-foreground`。底部一条 2px 进度条 `bg-agent` 宽度跟随 `progress%`（用 mint，因为这是 agent/channel 侧的「处理中」信号，且进度条足够小不会喧宾夺主）。
- **上传失败**：chip 叠 `bg-destructive/15`，中间 `AlertTriangle` `h-4 w-4 text-destructive`，点击重试。复用 Composer 错误提示已有的 destructive 色，不引入新红。
- **完成**：去掉遮罩，纯图。`border` 回到 `border`（L20%）。

### 多张排布
- `flex flex-wrap gap-2`，左到右、满行换行。最多显示建议 **8 张**（与一般 IM 体感一致，更多可滚动——但 MVP 可先不限）。
- 删除某张后，后续 chip 用 FLIP 思路平滑补位（见动效 §4.2），避免突然跳位。

---

## 3. 消息气泡内的图片展示（P0）

### 与文字混排
```
agent · 06:30
┌─────────────────────────────┐   ← max-w-[min(100%,44ch)]
│ 看一下这张图：              │   ← 文字行
│ ┌─────────────────────────┐ │
│ │                         │ │
│ │       image             │ │   ← 图片块，宽度 = 气泡内宽
│ │                         │ │
│ └─────────────────────────┘ │
│ 细节在左下角。              │   ← 文字继续
└─────────────────────────────┘
```
- 图片作为气泡内容的一部分，**沿用 `MessageRow` 的气泡容器**（self=`bg-primary/15`，others=`bg-card`），不另起容器。
- 图片块：紧跟在它对应的文字段（content 顺序渲染）。`mt-1.5`（与气泡内文字行间距一致），`w-full max-w-[320px]`，`rounded-md`（比气泡的 `rounded-lg` 小一级，建立「图 < 气泡」的层级），`overflow-hidden`。
- `object-cover` + 固定 **`aspect-[4/3]`**（统一比例，避免不同图比例把气泡撑得忽高忽低，破坏消息流的垂直节奏）。点击放大看原图比例（§lightbox）。
- 多图：`grid grid-cols-2 gap-1`，每张 `aspect-square rounded-md`（2 列网格用正方形更整齐）。>4 张走 3 列或折叠。

### 缩略 vs 原图
- 气泡内永远渲染**缩略图**（建议后端产出 ~480px 宽的 webp thumb）。点击 → lightbox 看原图。
- 缩略图加载期：`bg-muted` 占位 + shimmer（见动效 §4.3），避免白块。

---

## 4. 动效（P1，曲线 + 时长全部落到值）

项目 easing 基准：`cubic-bezier(0.16, 1, 0.3, 1)`（out-quint，Dialog 已在用）。图片相关全部沿用，不引入新曲线。已有 `prefers-reduced-motion` 全局兜底，无需额外处理。

### 4.1 预览 chip 入场（选中图片后出现）
- **触发**：chip 挂载。
- **效果**：`scale-95 opacity-0 → scale-100 opacity-100`。
- **类名**：`animate-in fade-in-0 zoom-in-95 duration-200 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)]`（与 Dialog open 的 zoom 一致，只是更快 200ms）。
- 多张时 **stagger 错峰**：第 N 张 `style={{ animationDelay: N*40ms }}`，max 240ms 封顶。错峰让「一次粘了 3 张」有节奏感而不是齐刷刷。

### 4.2 chip 删除补位
- **触发**：点 × 删一张。
- **效果**：被删 chip `animate-out fade-out-0 zoom-out-95 duration-150`，其余 chip 用 `layout`（若引入 framer-motion）或 FLIP 平滑移位。
- **MVP 降级**：若不引第三方，删的那张 `duration-150` 淡出后，其余直接 `transition-[transform] duration-200 ease-out` 补位即可（接受一次轻微 reflow，但 chip 小、影响小）。

### 4.3 缩略图加载 shimmer
- 气泡内缩略图未加载时：`bg-gradient-to-r from-muted via-accent/40 to-muted bg-[length:200%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]`。
- 需在 `index.css` 补一条 keyframes：
  ```css
  @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
  ```
- 加载完成 `onLoad` 切到 `opacity-100`（`transition-opacity duration-200`）。`prefers-reduced-motion` 下 shimmer 停在静态 muted 占位（全局兜底已覆盖 transition，但 `infinite` keyframe 需在该 media query 里 `animation: none`——index.css 已有 `* { animation-duration:0.001ms; animation-iteration-count:1 }` 类规则，确认覆盖即可）。

### 4.4 上传中进度条
- 底部 2px 条：`width` 从 0→100%，`transition-[width] duration-200 ease-out`（进度是离散更新，用 transition 平滑插值，避免阶梯感）。
- spinner（`Loader2 animate-spin`）走 Tailwind 默认 spin，无需自定。

### 4.5 点击放大（lightbox）—— 复用 Dialog 体系
- **直接用项目的 Radix Dialog**（`ui/dialog.tsx`），不要自造 lightbox。它已有：`bg-black/80 backdrop-blur-sm` 遮罩、`zoom-in-95 fade-in-0 duration-300`、close 200ms、easing `cubic-bezier(0.16,1,0.3,1)`、右上 X 关闭、Esc 关闭。完美匹配。
- 唯一要改：DialogContent 的 `max-w-lg p-6 bg-card` → lightbox 实例 override 成 `max-w-[90vw] max-h-[90vh] p-2 bg-transparent border-0 shadow-none`，图片 `max-h-[85vh] w-auto object-contain rounded-md`，居中。
- **额外**：点击遮罩区（overlay）关闭（Radix Dialog 默认支持）。图片本身不关闭，避免误触。
- **细节品味**：lightbox 图片可加一条极细 `ring-1 ring-white/10`（与 DialogContent 现有 `ring-1 ring-white/[0.06]` 一致），让图边缘在纯黑底上有「被托住」的质感，而不是悬浮生硬。

### 4.6 发送时的图片（发送中→已发送）
- 沿用 Composer 现有的发送逻辑（`sending` 态 Send 按钮 spinner）。图片气泡随消息一起走 `animate-slide-in`（MessageRow 已有），无需为图片单独做入场——它和文字一起作为一个消息单元滑入，保持空间连续性。

---

## 5. 优先级总表

| 级 | 项 | 落点 |
|---|---|---|
| **P0** | attach 按钮位置与长相 | composer.tsx，Paperclip ghost 按钮，同高，muted 灰 |
| **P0** | 预览 chip 规格 | 64px / rounded-md / border-border / × 按钮，上传中/失败态 |
| **P0** | 气泡内图片 | 沿用气泡容器，max-w-320，aspect-4/3，rounded-md，缩略图 |
| **P0** | lightbox 复用 Dialog | ui/dialog.tsx 体系，override 样式 |
| **P1** | chip 入场 stagger | animate-in zoom-95 200ms，错峰 40ms |
| **P1** | chip 删除补位 | animate-out 150ms + layout 补位 |
| **P1** | 缩略图 shimmer | 新增 keyframes，1.4s |
| **P1** | 上传进度条 | mint 2px 条，transition width 200ms |
| **P2** | lightbox 图片 ring-1 white/10 | 质感细节 |
| **P2** | 拖拽进入时输入条高亮 | dragover 时容器 border-agent/50 + bg-agent/5 |

---

## 6. 给王前端的交接点（结构性，不自己动）

以下属「新组件 / 跨组件」，交王前端实现：
1. `ImagePreviewChip` 组件（含上传中/失败/完成三态）。
2. 气泡内图片渲染：`renderContent` 或 MessageRow 需支持图片段（依赖后端消息内容契约——含 image 引用）。
3. lightbox：封装一个 `ImageLightbox` 包一层 Dialog。
4. `index.css` 补 `@keyframes shimmer`（这条我可自己加，见下）。

我可独立动手的小改：在 `index.css` 补 shimmer keyframes；调任何 token 值建议。涉及新组件/契约一律交王前端。
