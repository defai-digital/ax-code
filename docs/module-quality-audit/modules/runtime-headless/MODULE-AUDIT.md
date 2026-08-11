# MODULE-AUDIT: runtime-headless

| Field | Value |
|-------|-------|
| Unit slug | `runtime-headless` |
| Scope | `packages/ax-code/src/runtime/headless` |
| Resolved root | `packages/ax-code/src/runtime/headless` |
| XL filter | no |
| Wave / effort | Wave 2 / M |
| Risk tags | hot-path |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | ax-code-glm |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `12ef4c58e1ac29e5` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 11 / 1407 |
| Inventory ID | W2-03 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
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

### Exports (sample)
- `HeadlessRuntimeCommandMode@packages/ax-code/src/runtime/headless/command.ts:1`
- `HeadlessRuntimeModel@packages/ax-code/src/runtime/headless/command.ts:3`
- `HeadlessRuntimePart@packages/ax-code/src/runtime/headless/command.ts:10`
- `HeadlessPromptBody@packages/ax-code/src/runtime/headless/command.ts:15`
- `HeadlessCommandBody@packages/ax-code/src/runtime/headless/command.ts:26`
- `HeadlessShellBody@packages/ax-code/src/runtime/headless/command.ts:37`
- `HeadlessPermissionReplyBody@packages/ax-code/src/runtime/headless/command.ts:46`
- `HeadlessQuestionReplyBody@packages/ax-code/src/runtime/headless/command.ts:52`
- `HeadlessRuntimeCommand@packages/ax-code/src/runtime/headless/command.ts:58`
- `HeadlessRuntimeCommandResult@packages/ax-code/src/runtime/headless/command.ts:90`
- `commandAcceptsAsyncMode@packages/ax-code/src/runtime/headless/command.ts:94`
- `createHeadlessAutonomousPermissionReply@packages/ax-code/src/runtime/headless/effects.ts:4`
- `createHeadlessAutonomousQuestionReply@packages/ax-code/src/runtime/headless/effects.ts:11`
- `HeadlessProjectionEffectHandlers@packages/ax-code/src/runtime/headless/effects.ts:18`
- `executeHeadlessProjectionEffect@packages/ax-code/src/runtime/headless/effects.ts:28`
- `executeHeadlessProjectionEffects@packages/ax-code/src/runtime/headless/effects.ts:61`
- `encodeHeadlessEventLogRecord@packages/ax-code/src/runtime/headless/event-log.ts:5`
- `decodeHeadlessEventLogRecord@packages/ax-code/src/runtime/headless/event-log.ts:29`
- `parseHeadlessEventLogJsonLine@packages/ax-code/src/runtime/headless/event-log.ts:42`
- `decodeHeadlessEventLogLine@packages/ax-code/src/runtime/headless/event-log.ts:46`

### Tests
- `packages/ax-code/test/cli/runtime-restart.test.ts`
- `packages/ax-code/test/cli/tui/headless-sync-boundary.test.ts`
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

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (65) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags hot-path | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 11 source files; exports≈74
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: hot-path unit — checked unbounded patterns in read files
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/runtime/headless
Step 6: Hygiene: empty=0; notes: clean
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `12ef4c58e1ac29e5` |
| Dual-agent protocol | complete |
| Critical independent verify | ax-code-glm |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | implementer | 2026-08-11 | filesRead=11 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
