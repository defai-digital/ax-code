# MODULE-AUDIT: file

| Field | Value |
|-------|-------|
| Unit slug | `file` |
| Scope | `packages/ax-code/src/file` |
| Resolved root | `packages/ax-code/src/file` |
| XL filter | no |
| Wave / effort | Wave 3 / L |
| Risk tags | security, performance |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `4620a4dba682368d` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 7 / 1984 |
| Inventory ID | W3-06 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/file/ignore.ts` | 58 | 5 | 0 | 0 |
| `packages/ax-code/src/file/index.ts` | 781 | 14 | 0 | 0 |
| `packages/ax-code/src/file/protected.ts` | 60 | 3 | 0 | 0 |
| `packages/ax-code/src/file/ripgrep.ts` | 529 | 17 | 1 | 0 |
| `packages/ax-code/src/file/status.ts` | 58 | 6 | 0 | 0 |
| `packages/ax-code/src/file/time.ts` | 91 | 6 | 0 | 0 |
| `packages/ax-code/src/file/watcher.ts` | 407 | 8 | 0 | 0 |

### Exports (sample)
- `FileIgnore@packages/ax-code/src/file/ignore.ts:8`
- `FOLDER_NAMES@packages/ax-code/src/file/ignore.ts:13`
- `FILE_PATTERNS@packages/ax-code/src/file/ignore.ts:14`
- `PATTERNS@packages/ax-code/src/file/ignore.ts:16`
- `match@packages/ax-code/src/file/ignore.ts:18`
- `File@packages/ax-code/src/file/index.ts:19`
- `AccessDeniedError@packages/ax-code/src/file/index.ts:22`
- `Info@packages/ax-code/src/file/index.ts:30`
- `Info@packages/ax-code/src/file/index.ts:41`
- `Node@packages/ax-code/src/file/index.ts:43`
- `Node@packages/ax-code/src/file/index.ts:54`
- `Content@packages/ax-code/src/file/index.ts:56`
- `Content@packages/ax-code/src/file/index.ts:85`
- `Event@packages/ax-code/src/file/index.ts:87`
- `init@packages/ax-code/src/file/index.ts:526`
- `status@packages/ax-code/src/file/index.ts:530`
- `read@packages/ax-code/src/file/index.ts:618`
- `list@packages/ax-code/src/file/index.ts:708`
- `search@packages/ax-code/src/file/index.ts:753`
- `Protected@packages/ax-code/src/file/protected.ts:40`

### Tests
- `packages/ax-code/test/cli/tui/prompt-filepath.test.ts`
- `packages/ax-code/test/cli/tui/spinner-profile.test.ts`
- `packages/ax-code/test/code-intelligence/lockfile.test.ts`
- `packages/ax-code/test/command/file-command.test.ts`
- `packages/ax-code/test/file/fsmonitor.test.ts`
- `packages/ax-code/test/file/ignore-drift.test.ts`
- `packages/ax-code/test/file/ignore.test.ts`
- `packages/ax-code/test/file/index.test.ts`
- `packages/ax-code/test/file/path-traversal.test.ts`
- `packages/ax-code/test/file/ripgrep.test.ts`
- `packages/ax-code/test/file/status.test.ts`
- `packages/ax-code/test/file/time.test.ts`
- `packages/ax-code/test/file/watcher.test.ts`
- `packages/ax-code/test/lsp/server-profile.test.ts`
- `packages/ax-code/test/provider/agent-optimization-profile.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (59) | static map |
| Silent failure | empty catch (1) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,performance | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-file-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `4620a4dba682368d` |
| Dual-agent protocol | PENDING |
| Critical independent verify | pending |

### Exit checklist
- [ ] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [ ] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | — | — | protocol pending |
| Independent verifier | — | — | pending |
| Module owner | — | — | REVIEWING |
