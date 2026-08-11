# MODULE-AUDIT: mode

| Field | Value |
|-------|-------|
| Unit slug | `mode` |
| Scope | `packages/ax-code/src/mode` |
| Resolved root | `packages/ax-code/src/mode` |
| XL filter | no |
| Wave / effort | Wave 5 / M |
| Risk tags | correctness |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `b912c6f94d8c45e3` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 15 / 1917 |
| Inventory ID | W5-13 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/mode/arena.ts` | 154 | 7 | 0 | 0 |
| `packages/ax-code/src/mode/budget.ts` | 102 | 6 | 0 | 0 |
| `packages/ax-code/src/mode/council.ts` | 350 | 15 | 0 | 0 |
| `packages/ax-code/src/mode/debate.ts` | 151 | 8 | 0 | 0 |
| `packages/ax-code/src/mode/ensemble-shared.ts` | 177 | 8 | 0 | 0 |
| `packages/ax-code/src/mode/hybrid.ts` | 57 | 5 | 0 | 0 |
| `packages/ax-code/src/mode/implement-arena.ts` | 160 | 7 | 0 | 0 |
| `packages/ax-code/src/mode/index.ts` | 14 | 0 | 0 | 0 |
| `packages/ax-code/src/mode/json-mode-prompt.ts` | 24 | 2 | 0 | 0 |
| `packages/ax-code/src/mode/memory.ts` | 199 | 13 | 0 | 0 |
| `packages/ax-code/src/mode/policy.ts` | 171 | 8 | 0 | 0 |
| `packages/ax-code/src/mode/preflight.ts` | 160 | 12 | 0 | 0 |
| `packages/ax-code/src/mode/protocol.ts` | 42 | 2 | 0 | 0 |
| `packages/ax-code/src/mode/work-mode.ts` | 85 | 12 | 0 | 0 |
| `packages/ax-code/src/mode/worktree-policy.ts` | 71 | 5 | 0 | 0 |

### Exports (sample)
- `Arena@packages/ax-code/src/mode/arena.ts:6`
- `Verification@packages/ax-code/src/mode/arena.ts:7`
- `Strategy@packages/ax-code/src/mode/arena.ts:9`
- `ArenaCandidate@packages/ax-code/src/mode/arena.ts:11`
- `RankedCandidate@packages/ax-code/src/mode/arena.ts:24`
- `rankArenaCandidates@packages/ax-code/src/mode/arena.ts:66`
- `renderRankingMarkdown@packages/ax-code/src/mode/arena.ts:135`
- `Budget@packages/ax-code/src/mode/budget.ts:5`
- `EnsembleBudget@packages/ax-code/src/mode/budget.ts:6`
- `CheckInput@packages/ax-code/src/mode/budget.ts:15`
- `CheckResult@packages/ax-code/src/mode/budget.ts:22`
- `resolveCaps@packages/ax-code/src/mode/budget.ts:28`
- `check@packages/ax-code/src/mode/budget.ts:37`
- `Council@packages/ax-code/src/mode/council.ts:6`
- `Severity@packages/ax-code/src/mode/council.ts:7`
- `CouncilIssue@packages/ax-code/src/mode/council.ts:9`
- `CouncilMemberResult@packages/ax-code/src/mode/council.ts:18`
- `AgreementTier@packages/ax-code/src/mode/council.ts:27`
- `AggregatedIssue@packages/ax-code/src/mode/council.ts:29`
- `CouncilReport@packages/ax-code/src/mode/council.ts:42`

### Tests
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/prompt-view-model.test.ts`
- `packages/ax-code/test/cli/tui/dialog-help-view-model.test.ts`
- `packages/ax-code/test/cli/tui/dialog-model-options.test.ts`
- `packages/ax-code/test/cli/tui/dialog-select-view-model.test.ts`
- `packages/ax-code/test/cli/tui/directory-view-model.test.ts`
- `packages/ax-code/test/cli/tui/footer-view-model.test.ts`
- `packages/ax-code/test/cli/tui/input-mode.test.ts`
- `packages/ax-code/test/cli/tui/model-display-info.test.ts`
- `packages/ax-code/test/cli/tui/prompt-liveness-view-model.test.ts`
- `packages/ax-code/test/cli/tui/prompt-paste-view-model.test.ts`
- `packages/ax-code/test/cli/tui/prompt-view-model.test.ts`
- `packages/ax-code/test/cli/tui/run-mode-view-model.test.ts`
- `packages/ax-code/test/cli/tui/session-header-view-model.test.ts`
- `packages/ax-code/test/cli/tui/session-picker-view-model.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (110) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags correctness | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 15 source files; exports≈123
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/mode
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
| Static extract | ok fp `b912c6f94d8c45e3` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=15 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
