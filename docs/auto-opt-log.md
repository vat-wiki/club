# Club 自动优化日志（auto-opt）

每小时由定时任务触发：从 `cli / mcp / server` 中选定一个包，做一次聚焦改进，
验证（typecheck + build + test）全绿后提交并推送到 `origin/main`。

**最新记录在最上方。** 行格式：`UTC时间 | 包 | 改动摘要 | 验证 | commit`

轮转规则：优先选「最久未优化 + 测试覆盖最低」的包；并列时用 `date -u +%H` 对 3 取余
（0→server, 1→cli, 2→mcp）。

<!-- 第一条记录由首次运行追加 -->

2026-06-24 12:30 UTC | server | 修复 GET /messages 的 `limit` 无下界 bug：负值（如 `?limit=-1`）原样传给 SQLite（负 LIMIT = 无上限，可返回整张 messages 表）；抽取纯函数 `parseLimit()` clamp 到 [1,500] 并对 NaN/0/负数/非数字回退默认值；为 server 引入 vitest 首批测试(8 passing)。注：本轮全量 typecheck 因你正在进行的 `cli/tui.tsx`(shared→sdk) 重构未提交而变红，故隔离验证 server 并仅提交 server 文件 | typecheck/build/test=ok(隔离) | 2f956b3

2026-06-24 11:30 UTC | cli | 新增 zod 校验的纯函数 `parseConfig()`，修复损坏/不完整 config 导致的 "Invalid URL" 等晦涩报错（现按"未登录→club login"清晰提示）；为 cli 引入 vitest 首批测试(8 passing)。注：本轮工作区存在未提交的 `packages/web` 脚手架(缺依赖)使 root build 变红，故隔离验证 cli+shared 并仅提交 cli 文件 | typecheck/build/test=ok(隔离) | f3bd680

2026-06-24 11:01 UTC | mcp | 抽取纯 helpers(str/num/clampLimit)到 `helpers.ts` 并加 vitest 首批测试(11 passing)；硬化 `clampLimit`(NaN/±Inf→50)；顺带修复 root `build`/`dev`/`club` 的 bare `-w` 名不匹配 `@club/*` 导致 `npm run build` 报错 | typecheck/build/test=ok | 692231c
