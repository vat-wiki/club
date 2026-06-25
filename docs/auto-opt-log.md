# Club 自动优化日志（auto-opt）

每小时由定时任务触发：从 `cli / mcp / server` 中选定一个包，做一次聚焦改进，
验证（typecheck + build + test）全绿后提交并推送到 `origin/main`。

**最新记录在最上方。** 行格式：`UTC时间 | 包 | 改动摘要 | 验证 | commit`

轮转规则：优先选「最久未优化 + 测试覆盖最低」的包；并列时用 `date -u +%H` 对 3 取余
（0→server, 1→cli, 2→mcp）。

<!-- 第一条记录由首次运行追加 -->

2026-06-25 01:29 UTC | mcp | 把最复杂、最少测试的 listen 流程从 `runListen` 抽成纯函数 `listenForMatch(subscribe, mention, timeoutMs)`（注入 stream，返回匹配 Messages 或超时 `[]`；index.ts 接 `client.stream` 并格式化，行为不变），补 4 个测试（首条消息/首个 @mention/超时返回 `[]`/resolve 后停止订阅，用 fake timers+假 stream）。mcp 测试 17→21。注：全量 typecheck 因你新增的未提交 web `a11y.test.tsx` 变红，故隔离验证 mcp | typecheck/build/test=ok(隔离) | 5f7856b

2026-06-25 00:29 UTC | server | 把 `parseBearer` 从 `auth.ts` 抽到纯 `lib.ts`（行为不变，避开 import 时的 SQLite 副作用），并为两个安全关键的纯函数补测试：`hashKey`(`crypto.test.ts`，5 测：确定性/64 位 sha256 hex/对齐 node/样本无碰撞/不泄露明文) 与 `parseBearer`(`lib.test.ts` +6：提取 token/大小写不敏感/空白容忍与 trim/缺失或空/无 token/非 Bearer)。server 测试 8→19 | typecheck/build/test=ok | d6a7f19

2026-06-24 23:30 UTC | cli | 导出 `configPath()` 并补 7 个测试覆盖配置持久化层（`CLUB_CONFIG` 解析：绝对/相对/默认回退；`loadConfig` 缺文件返回 null；save→load 往返；save 覆盖旧配置；空字段保存后加载被拒=校验端到端成立，共 15 测试）。注：本轮 REPL 长时间关闭导致约 10 次 cron 补发集中在一条消息送达，**只执行 1 轮**（轮转只在真正执行时推进） | typecheck/build/test=ok | ace198d

2026-06-24 13:29 UTC | mcp | 把 `listen` 的 @mention 匹配规则从 `runListen` 内联代码抽成纯函数 `matchesMention()`（行为不变），补 6 个测试覆盖（字面匹配/大小写/必需 `@` 前缀/不匹配/无过滤路径/子串精度，共 17 测试）。本轮基线干净、全量门全绿，正常提交 | typecheck/build/test=ok | 651fdd4

2026-06-24 12:30 UTC | server | 修复 GET /messages 的 `limit` 无下界 bug：负值（如 `?limit=-1`）原样传给 SQLite（负 LIMIT = 无上限，可返回整张 messages 表）；抽取纯函数 `parseLimit()` clamp 到 [1,500] 并对 NaN/0/负数/非数字回退默认值；为 server 引入 vitest 首批测试(8 passing)。注：本轮全量 typecheck 因你正在进行的 `cli/tui.tsx`(shared→sdk) 重构未提交而变红，故隔离验证 server 并仅提交 server 文件 | typecheck/build/test=ok(隔离) | 2f956b3

2026-06-24 11:30 UTC | cli | 新增 zod 校验的纯函数 `parseConfig()`，修复损坏/不完整 config 导致的 "Invalid URL" 等晦涩报错（现按"未登录→club login"清晰提示）；为 cli 引入 vitest 首批测试(8 passing)。注：本轮工作区存在未提交的 `packages/web` 脚手架(缺依赖)使 root build 变红，故隔离验证 cli+shared 并仅提交 cli 文件 | typecheck/build/test=ok(隔离) | f3bd680

2026-06-24 11:01 UTC | mcp | 抽取纯 helpers(str/num/clampLimit)到 `helpers.ts` 并加 vitest 首批测试(11 passing)；硬化 `clampLimit`(NaN/±Inf→50)；顺带修复 root `build`/`dev`/`club` 的 bare `-w` 名不匹配 `@club/*` 导致 `npm run build` 报错 | typecheck/build/test=ok | 692231c
