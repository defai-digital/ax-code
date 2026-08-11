# MODULE-AUDIT: code-intelligence

| Field | Value |
|-------|-------|
| Unit slug | `code-intelligence` |
| Scope | `packages/ax-code/src/code-intelligence` |
| Resolved root | `packages/ax-code/src/code-intelligence` |
| XL filter | no |
| Wave / effort | Wave 5 / L |
| Risk tags | performance, persistence |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `c44e849991c5e3e8` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 12 / 4974 |
| Inventory ID | W5-07 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/code-intelligence/auto-index.ts` | 478 | 8 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/builder-impl.ts` | 1325 | 15 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/builder.ts` | 8 | 0 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/graph-context.ts` | 668 | 6 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/id.ts` | 19 | 8 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/index.ts` | 445 | 26 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/lockfile.ts` | 226 | 4 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/native-store.ts` | 275 | 31 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/query.ts` | 762 | 46 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/schema.sql.ts` | 216 | 9 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/syntactic.ts` | 306 | 5 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/watcher.ts` | 246 | 5 | 0 | 0 |

### Exports (sample)
- `AutoIndex@packages/ax-code/src/code-intelligence/auto-index.ts:62`
- `Event@packages/ax-code/src/code-intelligence/auto-index.ts:70`
- `IndexState@packages/ax-code/src/code-intelligence/auto-index.ts:96`
- `getState@packages/ax-code/src/code-intelligence/auto-index.ts:112`
- `setState@packages/ax-code/src/code-intelligence/auto-index.ts:130`
- `reportProgress@packages/ax-code/src/code-intelligence/auto-index.ts:156`
- `purgeHomeDirectoryGraphs@packages/ax-code/src/code-intelligence/auto-index.ts:186`
- `maybeStart@packages/ax-code/src/code-intelligence/auto-index.ts:238`
- `parseImportSpecifiers@packages/ax-code/src/code-intelligence/builder-impl.ts:121`
- `resolveContainingNodeFromDb@packages/ax-code/src/code-intelligence/builder-impl.ts:276`
- `lookupCallerKind@packages/ax-code/src/code-intelligence/builder-impl.ts:320`
- `planReferenceQueriesForBookmarks@packages/ax-code/src/code-intelligence/builder-impl.ts:442`
- `CodeGraphBuilder@packages/ax-code/src/code-intelligence/builder-impl.ts:460`
- `IndexTimings@packages/ax-code/src/code-intelligence/builder-impl.ts:487`
- `IndexResult@packages/ax-code/src/code-intelligence/builder-impl.ts:509`
- `IndexFileOptions@packages/ax-code/src/code-intelligence/builder-impl.ts:516`
- `indexFile@packages/ax-code/src/code-intelligence/builder-impl.ts:546`
- `IndexFilesOptions@packages/ax-code/src/code-intelligence/builder-impl.ts:1113`
- `LockHeldError@packages/ax-code/src/code-intelligence/builder-impl.ts:1127`
- `IndexFilesResult@packages/ax-code/src/code-intelligence/builder-impl.ts:1153`

### Tests
- `packages/ax-code/test/account/repo.test.ts`
- `packages/ax-code/test/account/service.test.ts`
- `packages/ax-code/test/account/token-decode.test.ts`
- `packages/ax-code/test/acp/agent-adapter.test.ts`
- `packages/ax-code/test/acp/agent-interface.test.ts`
- `packages/ax-code/test/acp/agent-prompt.test.ts`
- `packages/ax-code/test/acp/event-subscription.test.ts`
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/acp/session-list.test.ts`
- `packages/ax-code/test/acp/todo-plan-entries.test.ts`
- `packages/ax-code/test/agent/agent.test.ts`
- `packages/ax-code/test/agent/router.test.ts`
- `packages/ax-code/test/audit/bugfix.test.ts`
- `packages/ax-code/test/audit/json.test.ts`
- `packages/ax-code/test/audit/report.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (163) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags performance,persistence | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `c44e849991c5e3e8` |
| Dual-agent protocol | complete |
| Critical independent verify | codex-sol |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=13 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
