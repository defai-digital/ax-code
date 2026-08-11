# MODULE-AUDIT: runtime

| Field | Value |
|-------|-------|
| Unit slug | `runtime` |
| Scope | `packages/ax-code/src/runtime` |
| Resolved root | `packages/ax-code/src/runtime` |
| XL filter | no |
| Wave / effort | Wave 2 / L |
| Risk tags | hot-path |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `025804db4ce2eda9` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 19 / 2524 |
| Inventory ID | W2-02 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/runtime/debug-snapshot.ts` | 82 | 14 | 0 | 0 |
| `packages/ax-code/src/runtime/events.ts` | 8 | 1 | 0 | 0 |
| `packages/ax-code/src/runtime/failure-class.ts` | 95 | 7 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/command.ts` | 97 | 11 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/effects.ts` | 79 | 5 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/event-log.ts` | 63 | 4 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/event-sink-node.ts` | 62 | 2 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/event-sink.ts` | 35 | 5 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/event.ts` | 214 | 17 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/index.ts` | 10 | 0 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/projection.ts` | 444 | 7 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/replay.ts` | 105 | 4 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/runner.ts` | 149 | 5 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/runtime.ts` | 149 | 5 | 0 | 0 |
| `packages/ax-code/src/runtime/hot-path.ts` | 201 | 13 | 0 | 0 |
| `packages/ax-code/src/runtime/listen-security.ts` | 54 | 6 | 0 | 0 |
| `packages/ax-code/src/runtime/local-client.ts` | 30 | 3 | 0 | 0 |
| `packages/ax-code/src/runtime/service-manager.ts` | 540 | 24 | 0 | 0 |
| `packages/ax-code/src/runtime/shell-env.ts` | 107 | 3 | 0 | 0 |

### Exports (sample)
- `RuntimeDebugSnapshot@packages/ax-code/src/runtime/debug-snapshot.ts:5`
- `Trigger@packages/ax-code/src/runtime/debug-snapshot.ts:6`
- `Trigger@packages/ax-code/src/runtime/debug-snapshot.ts:9`
- `QueueOverflowPolicy@packages/ax-code/src/runtime/debug-snapshot.ts:11`
- `QueueOverflowPolicy@packages/ax-code/src/runtime/debug-snapshot.ts:14`
- `QueueCoalescingPolicy@packages/ax-code/src/runtime/debug-snapshot.ts:16`
- `QueueCoalescingPolicy@packages/ax-code/src/runtime/debug-snapshot.ts:19`
- `InstanceContext@packages/ax-code/src/runtime/debug-snapshot.ts:21`
- `InstanceContext@packages/ax-code/src/runtime/debug-snapshot.ts:28`
- `QueueMetrics@packages/ax-code/src/runtime/debug-snapshot.ts:30`
- `QueueMetrics@packages/ax-code/src/runtime/debug-snapshot.ts:47`
- `Snapshot@packages/ax-code/src/runtime/debug-snapshot.ts:49`
- `Snapshot@packages/ax-code/src/runtime/debug-snapshot.ts:60`
- `create@packages/ax-code/src/runtime/debug-snapshot.ts:62`
- `RuntimeEvent@packages/ax-code/src/runtime/events.ts:4`
- `RuntimeFailureClass@packages/ax-code/src/runtime/failure-class.ts:48`
- `Kind@packages/ax-code/src/runtime/failure-class.ts:49`
- `Kind@packages/ax-code/src/runtime/failure-class.ts:60`
- `Info@packages/ax-code/src/runtime/failure-class.ts:62`
- `Info@packages/ax-code/src/runtime/failure-class.ts:73`

### Tests
- `packages/ax-code/test/cli/runtime-restart.test.ts`
- `packages/ax-code/test/cli/tui/sync-runtime-adapter.test.ts`
- `packages/ax-code/test/cli/tui/sync-runtime-probe.test.ts`
- `packages/ax-code/test/cli/tui/sync-runtime-store.test.ts`
- `packages/ax-code/test/cli/tui/sync-runtime-sync.test.ts`
- `packages/ax-code/test/debug-engine/runtime-debug.test.ts`
- `packages/ax-code/test/harness/agentic-runtime-eval.test.ts`
- `packages/ax-code/test/installation/runtime-mode.test.ts`
- `packages/ax-code/test/quality/shadow-runtime-json.test.ts`
- `packages/ax-code/test/runtime/debug-snapshot.test.ts`
- `packages/ax-code/test/runtime/failure-class.test.ts`
- `packages/ax-code/test/runtime/headless/event-log.test.ts`
- `packages/ax-code/test/runtime/headless/event-sink-node.test.ts`
- `packages/ax-code/test/runtime/headless/projection.test.ts`
- `packages/ax-code/test/runtime/headless/replay.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (136) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags hot-path | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `025804db4ce2eda9` |
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
