# Optimization State — 2026-07-20

## Direction: 安全性 (Security)
Fix incorrect Content-Disposition placement in files.ts + commit related security tests.

## Uncommitted changes (wip):
- files.ts: Content-Disposition header added at route level (WRONG — applies to 201 POST response too)
- lib.test.ts: +182 lines parseJsonBody tests
- lib/json-content-type.test.ts: new, requireJson middleware tests (100 lines)
- routes/files.mime.test.ts: new, detectAndVerifyMime tests (100 lines)

## Fix needed:
Move Content-Disposition to only the GET /:id handler body, not the route level.

## Previous commits (skip):
- 性能, 文档, 最佳实践, 代码质量, 安全性(headers), 测试覆盖, 类型定义, 重构 — all done
