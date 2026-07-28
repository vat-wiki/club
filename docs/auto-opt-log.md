# Club 自动优化日志（auto-opt）

每小时由定时任务触发：从 `cli / mcp / server` 中选定一个包，做一次聚焦改进，
验证（typecheck + build + test）全绿后提交并推送到 `origin/main`。

**最新记录在最上方。** 行格式：`UTC时间 | 包 | 改动摘要 | 验证 | commit`

轮转规则：优先选「最久未优化 + 测试覆盖最低」的包；并列时用 `date -u +%H` 对 3 取余
（0→server, 1→cli, 2→mcp）。

<!-- 第一条记录由首次运行追加 -->

2026-06-25 05:36 UTC | cli | 修复 `read --limit` 不做客户端 clamp 的缺陷：原 `Number(opts.limit) || 50` 只挡 0/NaN，负数（如 `--limit -5`，truthy）原样穿透到 server 被静默 clamp 成 server 自己的默认值，用户无法预测返回条数；cli 是全栈唯一不 clamp 的客户端（server `parseLimit`、mcp `clampLimit` 都 clamp 到 [1,500]）。新增纯函数 `parseLimit`（`src/limit.ts`+`limit.test.ts`，对齐 stdin.ts/config.ts 的"纯工具+测试"模式），默认 50、clamp 到 [1,500]，`read.ts` 改用。cli 测试 19→25 | typecheck/build/test=ok | e66b2b9

2026-06-25 04:41 UTC | mcp | 把工具分发器（index.ts 的 switch——5 个工具的格式化/空结果/缺参/错误处理，此前零测试，只有 input-coercion helpers 被测）抽成 `dispatchTool(name, args, client)` 放进 helpers.ts（注入 `DispatchClient` 接口，与 ClubClient 类解耦但结构兼容；index.ts 改为只穿梭请求并包裹结果/异常为 text，行为完全不变）。补 13 个分发器测试（fake client：whoami / read+limit clamp+since 游标 / send+缺参守卫 / members+按 kind 出图标 / listen+命中+超时 / 未知工具 / 错误传播）。mcp 测试 21→34 | typecheck/build/test=ok | 27e6ebd

2026-06-25 04:01 UTC | server | 修复 GET `/members` 契约漂移：`getAllParticipants()` 返回 DB row（snake_case `created_at`），路由原样吐出，违反 shared 的 `Participant.createdAt`（camelCase）契约——`/me`、`/messages` 都做了 row→domain 映射，唯独 `/members` 漏了；TS 抓不到（fetch 结果运行时无类型）。加局部 `toParticipant()` 映射（与 `messages.ts` 的 `toMessage` 对称），补路由级回归测试（camelCase 精确形状 / 无 snake_case 泄漏 / 按 createdAt 升序，挂真实 SQLite 临时库经 Hono `app.request` 跑通）。server 测试 19→21。本轮工作区有既有未提交的 vitepress docs 脚手架改动，仅提交 server 文件 | typecheck/build/test=ok | e87323e

2026-06-25 02:29 UTC | cli | 修复 `send --stdin` 在交互式终端（无管道输入）无限挂起、且不处理 stdin 错误的 bug：抽 `readStream(stream)`（注入 stream，TTY 或 error 时 reject 而非挂死），`send.ts` 改用它，真实管道输入行为不变；补 4 个测试（拼接+end/空/TTY 拒绝/error 拒绝）。cli 测试 15→19 | typecheck/build/test=ok | c637932

2026-06-25 01:29 UTC | mcp | 把最复杂、最少测试的 listen 流程从 `runListen` 抽成纯函数 `listenForMatch(subscribe, mention, timeoutMs)`（注入 stream，返回匹配 Messages 或超时 `[]`；index.ts 接 `client.stream` 并格式化，行为不变），补 4 个测试（首条消息/首个 @mention/超时返回 `[]`/resolve 后停止订阅，用 fake timers+假 stream）。mcp 测试 17→21。注：全量 typecheck 因你新增的未提交 web `a11y.test.tsx` 变红，故隔离验证 mcp | typecheck/build/test=ok(隔离) | 5f7856b

2026-06-25 00:29 UTC | server | 把 `parseBearer` 从 `auth.ts` 抽到纯 `lib.ts`（行为不变，避开 import 时的 SQLite 副作用），并为两个安全关键的纯函数补测试：`hashKey`(`crypto.test.ts`，5 测：确定性/64 位 sha256 hex/对齐 node/样本无碰撞/不泄露明文) 与 `parseBearer`(`lib.test.ts` +6：提取 token/大小写不敏感/空白容忍与 trim/缺失或空/无 token/非 Bearer)。server 测试 8→19 | typecheck/build/test=ok | d6a7f19

2026-06-24 23:30 UTC | cli | 导出 `configPath()` 并补 7 个测试覆盖配置持久化层（`CLUB_CONFIG` 解析：绝对/相对/默认回退；`loadConfig` 缺文件返回 null；save→load 往返；save 覆盖旧配置；空字段保存后加载被拒=校验端到端成立，共 15 测试）。注：本轮 REPL 长时间关闭导致约 10 次 cron 补发集中在一条消息送达，**只执行 1 轮**（轮转只在真正执行时推进） | typecheck/build/test=ok | ace198d

2026-06-24 13:29 UTC | mcp | 把 `listen` 的 @mention 匹配规则从 `runListen` 内联代码抽成纯函数 `matchesMention()`（行为不变），补 6 个测试覆盖（字面匹配/大小写/必需 `@` 前缀/不匹配/无过滤路径/子串精度，共 17 测试）。本轮基线干净、全量门全绿，正常提交 | typecheck/build/test=ok | 651fdd4

2026-06-24 12:30 UTC | server | 修复 GET /messages 的 `limit` 无下界 bug：负值（如 `?limit=-1`）原样传给 SQLite（负 LIMIT = 无上限，可返回整张 messages 表）；抽取纯函数 `parseLimit()` clamp 到 [1,500] 并对 NaN/0/负数/非数字回退默认值；为 server 引入 vitest 首批测试(8 passing)。注：本轮全量 typecheck 因你正在进行的 `cli/tui.tsx`(shared→sdk) 重构未提交而变红，故隔离验证 server 并仅提交 server 文件 | typecheck/build/test=ok(隔离) | 2f956b3

2026-06-24 11:30 UTC | cli | 新增 zod 校验的纯函数 `parseConfig()`，修复损坏/不完整 config 导致的 "Invalid URL" 等晦涩报错（现按"未登录→club login"清晰提示）；为 cli 引入 vitest 首批测试(8 passing)。注：本轮工作区存在未提交的 `packages/web` 脚手架(缺依赖)使 root build 变红，故隔离验证 cli+shared 并仅提交 cli 文件 | typecheck/build/test=ok(隔离) | f3bd680

2026-06-24 11:01 UTC | mcp | 抽取纯 helpers(str/num/clampLimit)到 `helpers.ts` 并加 vitest 首批测试(11 passing)；硬化 `clampLimit`(NaN/±Inf→50)；顺带修复 root `build`/`dev`/`club` 的 bare `-w` 名不匹配 `@club/*` 导致 `npm run build` 报错 | typecheck/build/test=ok | 692231c
