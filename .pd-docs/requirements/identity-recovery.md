# 身份找回（Identity Recovery）

> **状态**：①问题已钉死、方案已定（**方向 D 已拍板推进，P0**，见 `first-contact.md` §4.2） ②未落地（AC1 已落地；AC2–AC11 待实现） ③server 契约有新增（见第 6 节）
> **维护者**：王产品
> **关联**：`docs/roadmap.md`、`docs/design.md`、`.pd-docs/requirements/agent-integration.md`、`.pd-docs/requirements/first-contact.md`（**上游入口决策**，已在此拍板方向 D）
> **触发**：主理人实测中换浏览器后身份丢失、找不回来。原话："要等找回的啊 @王产品 你是干嘛吃的 产品怎么设计的"。

---

## 1. 背景：一个 chat 产品最基本的能力，club 没有

club 的产品灵魂是「**人与 agent 平等参与**」——same backend, same key, same history，author type 是展示元数据不是权限边界。落到身份上，灵魂的硬推论是：**人必须是稳定、可被 @ 的对等方**（见 `agent-integration.md` §3.3「身份稳定性是平权与 mention 投递的前提，不可妥协」）。

但 club 现状下，**真人的身份根本稳定不了**。

### 1.1 现状（读代码钉死，非道听途说）

- **key 是一次性发放的不可记忆随机串**：`packages/server/src/routes/participants.ts` 生成 `club_${kind}_${base64url(24 bytes)}`，server 只存 `sha256(key)`（`packages/server/src/crypto.ts`），明文一次性返回后**再无任何途径获取**（`packages/server/src/db.ts` 的 `participants` 表只有 `id/name/kind/key_hash/created_at`，无任何恢复字段）。
- **web 全程零 key 可见 UI**：`grep -rn "copy.*key\|view.*key\|export.*key" packages/web/src/` 仅命中 `saveConn` 一行。`packages/web/src/components/auth-dialog.tsx` 有 "paste an existing key" 路径，但 web **从不把 key 展示给用户**——这个 paste 入口对真人是陷阱：他根本不知道自己的 key 是什么，也无从获取。
- **web 登出 = 永久删 key**：`packages/web/src/App.tsx` 的 `handleSignOut` 调 `clearConn`，只清 localStorage，**没有任何"你确定要丢掉这个身份吗"的警告，也没有任何找回路径**。
- **三端不对等**：CLI 把 key 明文存在 `~/.club/config.json`（`packages/cli/src/config.ts`），CLI 用户天然能 `cat` 出 key、能复制、能跨机搬运；**唯独 web 用户被蒙在鼓里**。同一个产品，三端身份的可控性天差地别——这直接破坏「same key」承诺的对称性。
- **零 recovery 端点**：`packages/server/src/routes/` 下 `me.ts`/`participants.ts`/`members.ts` 均无任何 recover/restore/passphrase 相关逻辑。

### 1.2 真实痛点（用户故事）

> 我是一个真人，用浏览器进了 club，给自己起名叫 alice，聊了一晚上。第二天换了个浏览器/清了缓存/手滑点了 sign out——**我回不去了**。我再"创建"一个 alice？server 报 `name "alice" is taken`（`participants.ts` 的 409）。我的身份、我的历史、别人 @ 我时该投递到的 inbox，全部永久锁死在一个我再也拿不到的随机串上。

这不是边缘 case，这是 chat 产品的**核心闭环里的一道断崖**：任何用浏览器的人，**换设备/清缓存/误操作**三件事任意一件发生，身份即永久蒸发。而这三件事在真人使用浏览器时是**必然发生的**。

### 1.3 为什么这是产品问题，不是 bug

bug 是「代码行为偏离了设计」。而这里**设计本身就是缺的**——club 一直在用「一次性临时呼号」的心态做身份（见第 9 节复盘），从未把「找回」纳入产品能力。这是产品方向的断层，归王产品，不归实现者。

---

## 2. 目标与非目标

### 2.1 目标

1. **真人换浏览器/清缓存/误登出后，能找回同一个身份**（同一个 `participant_id`、同一份历史、同一个可被 @ 的 name）——在 web 内、无需求助 CLI、无需联系管理员。
2. **三端身份可控性对等**：web 用户对自己的凭据拥有和 CLI 用户同等程度的掌控（看得到、复制得了、搬得走、丢得了也找得回）。
3. **不引入笨重的账号体系**——不搞邮箱注册、不搞手机号、不搞密码重置邮件、不搞 OAuth。club 的气质是「轻量、即来即用」，找回方案必须配得上这个气质。
4. **与现有 key 模型兼容演进**，不推倒重来、不破坏已有 participant 数据。

### 2.2 非目标（明确不做，防需求蔓延）

- **不做传统账号体系**：不引入邮箱、手机号、密码、第三方登录。这些是 chat 产品的"重型"解，与 club「即来即用」气质相悖；club 的身份哲学是「key 即身份」，找回方案是在这套哲学内补能力，不是替换它。
- **不做多身份合并/迁移**（本期）：找回只解决「回到同一个身份」，不解决「我有三个 alice 身份想合并成一个」。
- **不做基于 name 单独找回**：`name` 是 UNIQUE 但**不是秘密**，任何知道你 callsign 的人都能喊你，绝不能让"知道名字"等于"能领走身份"。
- **不做跨 server 的身份联邦**：找回是单 server 内的事。
- **本期不解决 agent 身份找回**：agent 通过 CLI/MCP 接入，key 在文件里、在 MCP 配置里，天然可备份可重发；agent 找回的痛感远低于真人 web 用户。agent 的"凭据管理"另立（见 §8 开放问题）。

---

## 3. 用户与场景

| # | 场景 | 当前 | 目标 |
|---|------|------|------|
| A | 第一次创建身份 | key 静默落 localStorage，用户从未见过它 | 创建时**让用户看见并保存**自己的凭据 |
| B | 换浏览器/换电脑 | 身份永久丢失 | 用保存的凭据，在新浏览器内几步回到原身份 |
| C | 清缓存/手滑 sign out | 身份永久丢失 | 同上 |
| D | 跨设备同时在线 | 不可能（key 锁在单浏览器） | 同一凭据在多设备用，互不干扰 |
| E | 凭据也丢了 | 无解 | 接受"凭据丢失=身份丢失"，但把概率压到最低（创建时强提示 + 一键复制） |

主用户：**用 web 进 club 的真人**。次要：用 CLI 但希望跨终端复用身份的人（CLI 已天然支持，本 PRD 顺带对齐）。

---

## 4. 候选方向与权衡

把空间扫干净，再给推荐。每个方向都过一遍「产品灵魂 + 轻量气质 + 三端对等」三道筛子。

### 方向 A：创建时展示 key + 一键复制，鼓励用户自己保存

- **做法**：创建身份后，弹一个「这是你的 key，请妥善保存，丢了找不回来」的界面，一键复制 + 下载 txt。
- **优点**：**零 server 改动**，纯前端。和 CLI 对等（CLI 用户一直就是这么干的）。保留 club「key 即身份」哲学不动。
- **缺点**：把"找回"的责任全甩给用户。真实用户**不会**去保存一串 `club_human_01J...`——它会和所有"请保存恢复码"的提示一样被秒关。痛点 C（清缓存/误登出）依然存在，因为 localStorage 一丢，用户就算存过 key 也得手动翻出来粘贴。
- **灵魂评估**：强化对等（web 终于看得见 key 了），但不解决"找回"本身——只是把"丢的概率"降低一点。

### 方向 B：key + 可记忆恢复短语（recovery passphrase）绑定

- **做法**：创建身份时，除了发 key，再生成/让用户设一个**人类可记忆的恢复短语**（如 4-6 个常见英文词 `river-cloud-ember-violet`），server 把 `passphrase_hash` 存到 participants 表。找回时用户报 name + passphrase，server 校验通过后**直接返回原 key 明文**（或换发新 key、把 key_hash 改成新的）。
- **优点**：真正解决"找回"——用户靠**脑子里的东西**回到身份，不依赖他保存过什么。气质轻（4 个词 vs 邮箱密码）。
- **缺点**：**server 要新增字段 + 端点 + 改 key 模型**（要么明文可找回、要么支持换发）。passphrase 可被暴力枚举（club 暂无限流，见 design.md §防滥用是 Phase 3）——4 个常见词的熵约 4×log2(2048)=44 bit，对在线暴力不够。引入一个"第二个秘密"实质上等于轻量密码，与「key 即身份」的纯粹性有张力。
- **灵魂评估**：解决找回，但**悄悄把 club 拖向账号体系**（有了"密码"的雏形）。需要警惕。

### 方向 C：导出/导入身份（identity export/import）

- **做法**：web 提供"导出身份"（下载含 key 的文件 / 显示二维码）和"导入身份"（上传 / 扫码）。
- **优点**：和 CLI 的 `config.json` 完全同构，三端对等最彻底。
- **缺点**：导出**必须在还没丢的时候做**——它解决的是"主动跨设备"，不解决"已经丢了"。对场景 B/C（已经丢了）无用。且导出的文件本身就是高价值凭证，存哪都是问题。
- **灵魂评估**：是对 A 的增强版，仍是"用户自己保管"路线。

### 方向 D：callsign + 一次性恢复码（fallback to A at creation, with B-lite recovery）

> 这是**推荐方向**，理由见 §5。先在这里点出形态。

- **做法**：组合拳——
  1. **创建时**：发 key 的**同时**，生成一个一次性的**恢复码**（`club_recover_<base64url>`，和 key 同熵级别、同样不可记忆），**强制**展示给用户并要求复制/下载（A 的内核）。
  2. **server**：participants 表加 `recover_hash`（sha256(恢复码)），和 `key_hash` 并列。
  3. **找回时**：web 提供"找回身份"入口，用户输入 **name + 恢复码**，server 校验 `recover_hash`，通过后**换发一个新 key**（更新该 participant 的 `key_hash`，**复用原 `participant_id` 和 name**），返回新 key 明文。**恢复码一次性、用后换发**（找回成功同时换发新恢复码，旧码失效；防止恢复码泄漏后被反复冒领。详见 §5.4 / `first-contact.md` §8.4 决策）。
- **为什么不是 B**：恢复码**不让用户记**，而是让用户**存**——和方向 A 同性质（"请保存这个"），但额外给了"已经丢了 key 但还留着恢复码"这条退路。passphrase（B）的劣势是熵不够、是把 club 拖向账号体系；恢复码（D）用机器生成的高熵串避开这两点，代价是"用户必须存"。
- **灵魂评估**：保留「key 即身份」哲学（key 仍是日常凭据，恢复码只是 fallback）；三端可对等（恢复码是个字符串，CLI 也能用）；不引入密码学意义上的"密码"。

---

## 5. 推荐方案：**方向 D（key + 一次性恢复码）**

### 5.1 为什么是 D，而不是更轻的 A

**A 解决的是"看得见 key"，没解决"找回"。** 用户的真实痛点是"key 已经丢了怎么回去"——A 在这种时刻无能为力。用户火了的触发点正是 A 缺失的那条退路。只做 A 等于没解决问题。

但 **D 的内核就是 A**（创建时强提示保存），只是在它之上加了一层"恢复码 + 换发"的退路。增量成本可控（一个字段、一个端点、一个一次性逻辑），换来的是真正的"找回"能力。这是**用最小的实体增加，补上最致命的断层**——符合「若无必要无增实体」的反向版：**此处有必要**。

### 5.2 为什么不是 B（passphrase）

两条硬伤：
1. **熵**：人脑能记的短语熵不够，club 当前无限流（design.md §防滥用是 Phase 3），在线暴力可枚举。要补限流又是另一摊事。
2. **气质污染**：passphrase 实质是"密码"，一旦有了密码，club 离"轻量账号体系"只剩一步——而账号体系是 §2.2 明确排除的非目标。恢复码是**机器生成的 fallback 凭据**，不是用户日常要记的东西，不会把 club 拖向"登录要输密码"的形态。

### 5.3 三端形态（关键：对等）

| 入口 | 创建时 | 找回时 | 日常 |
|------|--------|--------|------|
| **web** | 展示 key + 恢复码，强制复制/下载 | "找回身份"入口：name + 恢复码 → 换发新 key → 进房间 | key 在 localStorage |
| **CLI** | `club login` 打印 key + 恢复码到终端，提示存好 | `club recover <name> <code>` → 换发新 key，写入 `~/.club/config.json` | key 在 config.json |
| **MCP** | 创建由 CLI/脚本完成，MCP 消费已有 key；MCP 不直接创建带恢复码的身份 | 不在 MCP 范围（agent 找回见 §8） | key 在 MCP 配置 |

三端**用同一个 server 端点**、同一套恢复码语义——这就是「same backend, same key」在找回能力上的对等落地。

### 5.4 恢复码换发的关键决策

**用恢复码找回时，换发新 key，而不是返回原 key 明文。** 理由：
- server 从不存 key 明文（现状），返回原 key 意味着要改架构去存明文——**倒退**，破坏现有安全模型。
- 换发新 key 只需更新 `key_hash`，key 明文依然从不落地存储，和现状一致。
- **恢复码一次性、用后换发**：找回成功后，server 把该 participant 的 `recover_hash` **换发为新值**（同时返回新恢复码让用户重新保存），而非置空。防止旧恢复码泄漏后被反复使用，且保证每个 participant 始终有一个可用恢复码。（此"换发"策略由 `first-contact.md` §8.4 拍板，原"作废 vs 换发"开放问题已定。）

---

## 6. 对 server 契约的影响（王后端照此实现）

### 6.1 数据层（`packages/server/src/db.ts`）

- **migration v2**：`participants` 表新增 `recover_hash TEXT`（nullable，sha256(恢复码)；NULL 表示已用或未设）。
- 新增 db helper：`getParticipantForRecover(name)`（按 name 取行，含 `recover_hash`）、`updateParticipantKey(id, newKeyHash)`、`updateParticipantRecover(id, newHash)`（**换发恢复码**策略，配合 §5.4 / `first-contact.md` §8.4 决策）。

### 6.2 端点（`packages/server/src/routes/participants.ts` 扩展）

- **`POST /participants`**（改造）：响应体从 `{ key, participant }` 扩展为 `{ key, recoverCode, participant }`。**恢复码明文一次性返回**，和 key 同样性质。
- **`POST /participants/recover`**（新增）：入参 `{ name, recoverCode }`，校验 `sha256(recoverCode) === participants.recover_hash`（且 `recover_hash` 非空）。
  - 成功：生成新 key，`updateParticipantKey` + `updateParticipantRecover(newHash)`（**换发新恢复码**，由 `first-contact.md` §8.4 拍板），返回 `{ key, recoverCode, participant }`（`recoverCode` 为新换发的，用户重新保存）。**`participant` 复用原 id 与 name**。
  - 失败：`401 invalid recovery code`（**不区分"恢复码错"和"name 不存在"**，避免 name 枚举）。
- **恢复码生成**：复用 `newKey` 的熵源，前缀 `club_recover_`，与 key 区分。

### 6.3 与现有 key 模型的兼容演进

- 老数据（`recover_hash` 为 NULL）：**不强制补**。这些用户日常 key 仍可用；若想获得找回能力，可在 web "设置"里主动生成恢复码（调用一个 `POST /me/recover-code`，需当前 key 鉴权）——**渐进迁移，不破坏存量**。
- 新建身份：默认带恢复码。

### 6.4 安全注意（写进验收）

- 恢复码错误响应**不得泄露 name 是否存在**（统一 401）。
- 找回端点**不限流是已知风险**（design.md 把限流划到 Phase 3）——恢复码是高熵串（和 key 同级），在线暴力不可行，可接受；但**恢复码用后必须换发作废旧值**（§5.4），防止泄漏后被永久持有。
- 恢复码明文**仅在创建和找回成功时各返回一次**，其余时刻不可获取。

---

## 7. 验收标准（用户故事级，可直接喂王测开）

### 7.1 创建

- **AC1**：web 创建身份后，UI 同时展示 key 与恢复码，二者各有一键复制；用户**必须**主动操作（复制或下载或确认"我已保存"）才能进入房间。（验证：playwright 驱动，断言两段文本存在且复制按钮可点。）
- **AC2**：CLI `club login` 输出含 key 行与恢复码行，提示"请妥善保存，丢失后用于找回"。
- **AC3**：server `POST /participants` 响应含 `key`、`recoverCode`、`participant` 三字段；DB 中该 participant 的 `recover_hash = sha256(recoverCode)`。

### 7.2 找回（核心）

- **AC4**：在浏览器 A 创建身份 alice，记下恢复码；在浏览器 B 打开 web，点"找回身份"，输入 `alice` + 恢复码 → 成功进入房间，**`participant.id` 与浏览器 A 的 alice 完全一致**，能看到同一份历史。（端到端用户故事，**这是这条 PRD 的验收锚点**。）
- **AC5**：AC4 成功后，浏览器 A 里那个旧 key **失效**（`GET /me` 返回 401）——因为 key_hash 已被换发更新。（验证：用旧 key 调 `/me` 断言 401。）
- **AC6**：AC4 用的那个恢复码**不能再用第二次**：再用同名同码找回 → 401。（断言 `recover_hash` 已置空或已换。）
- **AC7**：恢复码错误时返回 401，**响应体不得透露 name 是否存在**（用不存在的 name + 任意码，与存在的 name + 错误码，响应状态码与 body 结构一致）。
- **AC8**：CLI `club recover alice <code>` 成功后，`~/.club/config.json` 的 key 被更新为新 key，`club whoami` 返回 alice。

### 7.3 三端对等

- **AC9**：web 创建得到的 key，能用于 CLI `club login --key <key>`；CLI 创建得到的 key，能粘贴进 web 的"paste an existing key"。**同一个 key 跨端通用**（现状已成立，回归保护）。

### 7.4 兼容

- **AC10**：升级后，老 participant（`recover_hash` NULL）日常 `GET /me` 不受影响；其 key 继续有效。

### 7.5 非目标守护（防止偷偷做成账号体系）

- **AC11**：找回流程**不收集邮箱/手机号**，**不发任何邮件**，**不要求设密码**。（回归保护：grep 响应与 UI，不得出现这些字样。）

---

## 8. 开放问题

1. **~~恢复码用后是"作废"还是"换发新恢复码"？~~** → **已决策：换发。**（找回成功后返回新恢复码，用户重新保存）——保持每个 participant 始终有一个可用恢复码，体验更连贯。由 `first-contact.md` §8.4 拍板，已落实到 §5.4 / §6.2。
2. **是否要"主动重置恢复码"入口**（已登录状态下，`POST /me/recover-code` 生成新的）？推荐做——既服务于存量迁移（§6.3），也让用户怀疑恢复码泄漏时能自助换。优先级 P1，不阻塞 P0 找回闭环。
3. **agent 身份找回**：本期不做。但若日后 agent 用户也想要找回（key 丢了），同套机制可复用——恢复码本就与 `kind` 无关。留作 P2。
4. **恢复码的展示形态**：纯文本 vs 二维码（方便手机拍照存档）。倾向纯文本起步，二维码 P2。
5. **"我两个都没了"**（key 和恢复码都丢）：无解，接受。但要在创建 UI 里把话说清：**恢复码丢了真的找不回来**，不是吓唬。

---

## 9. 复盘：为什么 club 之前漏了"找回"

诚实回答，不甩锅。

### 9.1 根因：路径依赖——「一次性临时呼号」的心智遗留

club 最早的心智模型是**「临时呼号」**：进来、聊几句、走人，身份是一次性的。在这个心智下：
- key 设计成"一次性发放、不存明文、不可找回"是**自洽**的——一次性东西本来就不该找回。
- web 不展示 key 也是**自洽**的——临时用户不需要管理凭据，localStorage 兜着就行。
- "paste an existing key" 也是**自洽**的——它服务的是"我在 CLI 创建过、想进 web"这种**主动跨端**场景，不是服务真人找回。

但产品演化了。`agent-integration.md` §3 已经把身份模型修正为「**进程 ≠ 身份**」「**身份稳定性是平权与 mention 投递的前提，不可妥协**」——agent 的身份被明确要求稳定。**问题在于：这套"身份必须稳定"的修正，只落到了 agent 身上，没有反哺到真人身上。** 真人依然活在"一次性呼号"的旧设计里。**灵魂（人机平等）说了人要稳定，但产品落地偷偷把"稳定"只给了 agent**——这是断层。

### 9.2 gatekeeper 在哪失守

club 的需求 gatekeeper 是王产品（我）。失守点有三：

1. **把"创建身份"当成了 onboarding 的终点**。需求文档/验收都停在"用户能进房间"，**从未把"身份生命周期"作为一个完整需求来写**——创建之后呢？丢了怎么办？换设备怎么办？这些是 onboarding 之后的必然问题，但 PRD 视野停在门口。
2. **三端对等的检查没落到实处**。灵魂写了"same key"，但验收时只验了"key 能跨端用"，**没验"用户对 key 的可控性跨端对等"**——CLI 用户能 `cat` key，web 用户不能，这个不对等没人查。
3. **"轻量"被当成了不做账号体系的借口，顺手把找回也一起砍了**。「不做笨重账号体系」是正确的非目标（§2.2），但找回 ≠ 账号体系。找回可以用恢复码这种轻量方式实现。**把"不做账号"扩大化成"不做找回"，是产品判断的滑坡**。

### 9.3 教训（沉淀进日后的需求检查清单）

- **每个涉及"身份/凭据"的需求，必须回答三个问题**：创建时用户拿到什么？丢了怎么找回？跨端怎么复用？三个答不全，需求没写完。
- **"same X" 类的灵魂承诺，验收时要验"用户对 X 的可控性"，不只验"X 能不能用"**。
- **"不做笨重解"不等于"不做"**——轻量解（恢复码）往往是存在的，别用非目标当偷懒的挡箭牌。

主理人那句"产品怎么设计的"问得对。club 的身份设计在 agent 侧已经成熟，在真人侧还停留在原型期。这份 PRD 是补课。
