# Club 自动优化日志（auto-opt）

每小时由定时任务触发：从 `cli / mcp / server` 中选定一个包，做一次聚焦改进，
验证（typecheck + build + test）全绿后提交并推送到 `origin/main`。

**最新记录在最上方。** 行格式：`UTC时间 | 包 | 改动摘要 | 验证 | commit`

轮转规则：优先选「最久未优化 + 测试覆盖最低」的包；并列时用 `date -u +%H` 对 3 取余
（0→server, 1→cli, 2→mcp）。

<!-- 第一条记录由首次运行追加 -->

2026-06-24 11:01 UTC | mcp | 抽取纯 helpers(str/num/clampLimit)到 `helpers.ts` 并加 vitest 首批测试(11 passing)；硬化 `clampLimit`(NaN/±Inf→50)；顺带修复 root `build`/`dev`/`club` 的 bare `-w` 名不匹配 `@club/*` 导致 `npm run build` 报错 | typecheck/build/test=ok | 692231c
