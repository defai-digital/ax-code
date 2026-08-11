# MODULE-AUDIT: snapshot

| Field | Value |
|-------|-------|
| Unit slug | `snapshot` |
| Scope | `packages/ax-code/src/snapshot` |
| Resolved root | `packages/ax-code/src/snapshot` |
| XL filter | no |
| Wave / effort | Wave 2 / M |
| Risk tags | persistence |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `30b5959ec374a04e` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 570 |
| Inventory ID | W2-12 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/snapshot/index.ts` | 570 | 13 | 0 | 0 |

### Exports (sample)
- `Snapshot@packages/ax-code/src/snapshot/index.ts:14`
- `Patch@packages/ax-code/src/snapshot/index.ts:15`
- `Patch@packages/ax-code/src/snapshot/index.ts:19`
- `FileDiff@packages/ax-code/src/snapshot/index.ts:21`
- `FileDiff@packages/ax-code/src/snapshot/index.ts:33`
- `init@packages/ax-code/src/snapshot/index.ts:310`
- `cleanup@packages/ax-code/src/snapshot/index.ts:314`
- `track@packages/ax-code/src/snapshot/index.ts:319`
- `patch@packages/ax-code/src/snapshot/index.ts:368`
- `restore@packages/ax-code/src/snapshot/index.ts:398`
- `revert@packages/ax-code/src/snapshot/index.ts:461`
- `diff@packages/ax-code/src/snapshot/index.ts:497`
- `diffFull@packages/ax-code/src/snapshot/index.ts:523`

### Tests
- `packages/ax-code/test/replay/code-graph-snapshot.test.ts`
- `packages/ax-code/test/runtime/debug-snapshot.test.ts`
- `packages/ax-code/test/snapshot/git-output.test.ts`
- `packages/ax-code/test/snapshot/snapshot.test.ts`
- `packages/ax-code/test/tool/visual-snapshot.test.ts`
- `packages/ax-code/test/visual/snapshot.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (13) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags persistence | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `30b5959ec374a04e` |
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
