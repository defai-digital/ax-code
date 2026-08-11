# MODULE-AUDIT: replay

| Field | Value |
|-------|-------|
| Unit slug | `replay` |
| Scope | `packages/ax-code/src/replay` |
| Resolved root | `packages/ax-code/src/replay` |
| XL filter | no |
| Wave / effort | Wave 2 / M |
| Risk tags | persistence, correctness |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `a43c512ee2e3a79f` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 9 / 2197 |
| Inventory ID | W2-11 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/replay/agent-control-query.ts` | 319 | 18 | 0 | 0 |
| `packages/ax-code/src/replay/compare.ts` | 429 | 22 | 0 | 0 |
| `packages/ax-code/src/replay/event-log.sql.ts` | 33 | 1 | 0 | 0 |
| `packages/ax-code/src/replay/event.ts` | 329 | 32 | 0 | 0 |
| `packages/ax-code/src/replay/index.ts` | 5 | 2 | 0 | 0 |
| `packages/ax-code/src/replay/query.ts` | 373 | 19 | 0 | 0 |
| `packages/ax-code/src/replay/recorder.ts` | 123 | 6 | 0 | 0 |
| `packages/ax-code/src/replay/replay.ts` | 492 | 11 | 0 | 0 |
| `packages/ax-code/src/replay/tool-call-query.ts` | 94 | 6 | 0 | 0 |

### Exports (sample)
- `AgentControlReplayQuery@packages/ax-code/src/replay/agent-control-query.ts:8`
- `TimelineTone@packages/ax-code/src/replay/agent-control-query.ts:26`
- `TimelineKind@packages/ax-code/src/replay/agent-control-query.ts:27`
- `TimelineItem@packages/ax-code/src/replay/agent-control-query.ts:29`
- `TimelineRow@packages/ax-code/src/replay/agent-control-query.ts:41`
- `ReadModel@packages/ax-code/src/replay/agent-control-query.ts:46`
- `normalizeAgentControlEvent@packages/ax-code/src/replay/agent-control-query.ts:52`
- `isAgentControlEvent@packages/ax-code/src/replay/agent-control-query.ts:89`
- `summaryBySession@packages/ax-code/src/replay/agent-control-query.ts:93`
- `readModelBySession@packages/ax-code/src/replay/agent-control-query.ts:98`
- `readModelFromRows@packages/ax-code/src/replay/agent-control-query.ts:103`
- `readModelFromEvents@packages/ax-code/src/replay/agent-control-query.ts:111`
- `summaryFromRows@packages/ax-code/src/replay/agent-control-query.ts:119`
- `summaryFromEvents@packages/ax-code/src/replay/agent-control-query.ts:123`
- `timelineBySession@packages/ax-code/src/replay/agent-control-query.ts:127`
- `timelineFromRows@packages/ax-code/src/replay/agent-control-query.ts:132`
- `timelineFromEvents@packages/ax-code/src/replay/agent-control-query.ts:139`
- `timelineItemFromEvent@packages/ax-code/src/replay/agent-control-query.ts:146`
- `ReplayCompare@packages/ax-code/src/replay/compare.ts:6`
- `ScoreKey@packages/ax-code/src/replay/compare.ts:7`

### Tests
- `packages/ax-code/test/cli/debug-replay.test.ts`
- `packages/ax-code/test/replay/agent-control-events.test.ts`
- `packages/ax-code/test/replay/agent-control-query.test.ts`
- `packages/ax-code/test/replay/code-graph-snapshot.test.ts`
- `packages/ax-code/test/replay/code-intelligence-replay.test.ts`
- `packages/ax-code/test/replay/query.test.ts`
- `packages/ax-code/test/replay/reconstruct.test.ts`
- `packages/ax-code/test/replay/recorder-batching.test.ts`
- `packages/ax-code/test/replay/tool-call-query.test.ts`
- `packages/ax-code/test/replay/tool-result-metadata.test.ts`
- `packages/ax-code/test/runtime/headless/replay.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (117) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags persistence,correctness | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `a43c512ee2e3a79f` |
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
