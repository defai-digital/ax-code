# Bug Reports Index

## Open Reports

None.

## Resolved (2026-05-28)

| ID | Severity | Resolution | Module | Summary |
|----|----------|------------|--------|---------|
| BUG-001 | HIGH | false positive | tool/bash | `proc.once("close")` race — all code between spawn and Promise constructor is synchronous; no window for close to fire before listener registers |
| BUG-002 | HIGH | false positive | tool/task | Abort listener race — abort listeners in `execute()` are registered before any await; outer `Agent.list()` await is in a different ctx scope |
| BUG-003 | HIGH | fixed | session/status | LRU eviction cycled busy sessions without reducing size; removed re-insertion dance, evict unconditionally |
| BUG-004 | HIGH | fixed | session/prompt-loop-queue | Fire-and-forget `cancel()` swallowed errors; made callback async and wrapped cancel in try/catch |
| BUG-005 | MEDIUM | false positive | tool/bash | Abort listener registered after spawn — all intervening code is synchronous so no event loop yield before registration |
| BUG-006 | MEDIUM | fixed | tool/apply_patch | `FileTime.read()` missing after delete; added inside `FileTime.withLock` to match add/update pattern |
| BUG-007 | LOW | fixed | tool/apply_patch | `resolvePatchPath(move_path)` result discarded; stored result and applied full pre-flight security checks to move target |
| BUG-008 | MEDIUM | fixed | session/compaction | `Agent.get("compaction")` result unchecked; added guard that throws when agent is undefined (e.g. disabled in config) |
| BUG-009 | MEDIUM | false positive | provider/provider | TOCTOU on model cache Maps — JS single-threaded: the check-to-set sequence is fully synchronous so no concurrent caller can interleave |
| BUG-010 | MEDIUM | fixed | session/prompt-tools | MCP schema cache TOCTOU; added post-await cache re-check so a concurrently-computed entry is reused instead of overwritten |
