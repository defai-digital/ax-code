# MODULE-AUDIT: ui-sync

| Field | Value |
|-------|-------|
| Unit slug | `ui-sync` |
| Scope | `desktop/packages/ui/src/sync` |
| Resolved root | `desktop/packages/ui/src/sync` |
| XL filter | no |
| Wave / effort | Wave 8 / L |
| Risk tags | desktop |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `d37def591380329e` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 71 / 20253 |
| Inventory ID | W8-08 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/sync/__tests__/event-pipeline-online.test.ts` | 157 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/event-pipeline-permanent-error.test.ts` | 159 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/event-pipeline-resume.test.ts` | 190 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts` | 79 | 7 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/event-pipeline.bench.ts` | 406 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/event-pipeline.test.ts` | 1241 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/event-reducer.test.ts` | 636 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/eviction.test.ts` | 188 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/live-aggregate.test.ts` | 116 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/live-selector-memo.test.ts` | 143 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/materialization.test.ts` | 155 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/session-prefetch-cache.test.ts` | 28 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/session-switch-resync.test.ts` | 213 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/streaming-metrics.test.ts` | 146 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/assistant-fork.test.ts` | 84 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/assistant-fork.ts` | 60 | 4 | 0 | 0 |
| `desktop/packages/ui/src/sync/binary.ts` | 62 | 6 | 0 | 0 |
| `desktop/packages/ui/src/sync/bootstrap.ts` | 265 | 2 | 0 | 0 |
| `desktop/packages/ui/src/sync/child-store.ts` | 233 | 2 | 0 | 0 |
| `desktop/packages/ui/src/sync/content-cache.ts` | 94 | 9 | 0 | 0 |
| `desktop/packages/ui/src/sync/debug.ts` | 97 | 3 | 0 | 0 |
| `desktop/packages/ui/src/sync/event-pipeline.test.ts` | 217 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/event-pipeline.ts` | 1084 | 6 | 0 | 0 |
| `desktop/packages/ui/src/sync/event-reducer.ts` | 794 | 6 | 0 | 0 |
| `desktop/packages/ui/src/sync/event-routing.test.ts` | 308 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/event-routing.ts` | 426 | 12 | 0 | 0 |
| `desktop/packages/ui/src/sync/eviction.ts` | 54 | 3 | 0 | 0 |
| `desktop/packages/ui/src/sync/global-sync-store.ts` | 28 | 9 | 0 | 0 |
| `desktop/packages/ui/src/sync/input-store.test.ts` | 144 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/input-store.ts` | 176 | 3 | 0 | 0 |

### Exports (sample)
- `TestEventTarget@desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts:3`
- `createEventTarget@desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts:9`
- `SavedBrowserGlobals@desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts:32`
- `saveBrowserGlobals@desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts:38`
- `restoreBrowserGlobals@desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts:46`
- `setNavigatorOnline@desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts:55`
- `installEventPipelineBrowserGlobals@desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts:62`
- `AssistantForkSourceChoice@desktop/packages/ui/src/sync/assistant-fork.ts:1`
- `AssistantForkCurrentChoice@desktop/packages/ui/src/sync/assistant-fork.ts:8`
- `AssistantForkSendChoice@desktop/packages/ui/src/sync/assistant-fork.ts:18`
- `resolveAssistantForkSendChoice@desktop/packages/ui/src/sync/assistant-fork.ts:39`
- `Binary@desktop/packages/ui/src/sync/binary.ts:2`
- `search@desktop/packages/ui/src/sync/binary.ts:4`
- `has@desktop/packages/ui/src/sync/binary.ts:28`
- `find@desktop/packages/ui/src/sync/binary.ts:32`
- `findIndex@desktop/packages/ui/src/sync/binary.ts:37`
- `insert@desktop/packages/ui/src/sync/binary.ts:42`
- `bootstrapGlobal@desktop/packages/ui/src/sync/bootstrap.ts:62`
- `bootstrapDirectory@desktop/packages/ui/src/sync/bootstrap.ts:111`
- `DirectoryStore@desktop/packages/ui/src/sync/child-store.ts:7`

### Tests
- `packages/ax-code/test/cli/tui/headless-sync-boundary.test.ts`
- `packages/ax-code/test/cli/tui/session-entry-sync.test.ts`
- `packages/ax-code/test/cli/tui/sync-bootstrap-assembly.test.ts`
- `packages/ax-code/test/cli/tui/sync-bootstrap-controller.test.ts`
- `packages/ax-code/test/cli/tui/sync-bootstrap-flow.test.ts`
- `packages/ax-code/test/cli/tui/sync-bootstrap-phase-plan.test.ts`
- `packages/ax-code/test/cli/tui/sync-bootstrap-phase.test.ts`
- `packages/ax-code/test/cli/tui/sync-bootstrap-plan.test.ts`
- `packages/ax-code/test/cli/tui/sync-bootstrap-request.test.ts`
- `packages/ax-code/test/cli/tui/sync-bootstrap-runner.test.ts`
- `packages/ax-code/test/cli/tui/sync-bootstrap-store.test.ts`
- `packages/ax-code/test/cli/tui/sync-bootstrap-task.test.ts`
- `packages/ax-code/test/cli/tui/sync-lifecycle.test.ts`
- `packages/ax-code/test/cli/tui/sync-query.test.ts`
- `packages/ax-code/test/cli/tui/sync-result.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (290) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `d37def591380329e` |
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
