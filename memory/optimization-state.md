# Optimization State — 2026-07-20

## Latest: 安全性 (Security) — Content-Disposition header
Added `Content-Disposition: attachment` with RFC 5987 `filename*` to the
GET `/files/:id` endpoint so "Save As…" uses the original upload filename
instead of the random id. New pure function `contentDispositionFilename()`
with 8 unit tests. tsc 0 error, server 282 pass (9 pre-existing fail, no
new regression).

## Previous commits (skip):
- 重构, 测试覆盖, 最佳实践, 代码质量, 文档, 性能, 类型定义, 安全性(headers) — all done
- security(Content-Disposition) — just committed this session

## Uncommitted changes:
- (none)
