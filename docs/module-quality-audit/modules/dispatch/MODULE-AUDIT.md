# MODULE-AUDIT: dispatch

| Field | Value |
|-------|-------|
| Unit slug | `dispatch` |
| Scope | `packages/ax-code/src/dispatch` |
| Resolved root | `packages/ax-code/src/dispatch` |
| XL filter | no |
| Wave / effort | Wave 2 / M |
| Risk tags | concurrency |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `9d68dd4a498002ed` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 374 |
| Inventory ID | W2-06 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/dispatch/index.ts` | 374 | 9 | 0 | 0 |

### Exports (sample)
- `DispatchSpec@packages/ax-code/src/dispatch/index.ts:24`
- `DispatchStatus@packages/ax-code/src/dispatch/index.ts:35`
- `DispatchResult@packages/ax-code/src/dispatch/index.ts:37`
- `ExecutorOutput@packages/ax-code/src/dispatch/index.ts:51`
- `DispatchExecutor@packages/ax-code/src/dispatch/index.ts:67`
- `MergeStrategy@packages/ax-code/src/dispatch/index.ts:80`
- `DispatcherEventSink@packages/ax-code/src/dispatch/index.ts:87`
- `DispatchOptions@packages/ax-code/src/dispatch/index.ts:94`
- `dispatch@packages/ax-code/src/dispatch/index.ts:113`

### Tests
- `packages/ax-code/test/cli/tui/dialogs-action-dispatch.test.ts`
- `packages/ax-code/test/code-intelligence/query-native-dispatch.test.ts`
- `packages/ax-code/test/dispatch/index.test.ts`
- `packages/ax-code/test/dispatch/merge-strategies.test.ts`
- `packages/ax-code/test/workflow/dispatch-adapter.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (9) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags concurrency | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `9d68dd4a498002ed` |
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
