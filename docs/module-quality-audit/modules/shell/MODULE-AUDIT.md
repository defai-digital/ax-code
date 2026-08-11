# MODULE-AUDIT: shell

| Field | Value |
|-------|-------|
| Unit slug | `shell` |
| Scope | `packages/ax-code/src/shell` |
| Resolved root | `packages/ax-code/src/shell` |
| XL filter | no |
| Wave / effort | Wave 3 / L |
| Risk tags | security |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `de00b2924e381514` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 111 |
| Inventory ID | W3-04 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/shell/shell.ts` | 111 | 5 | 0 | 0 |

### Exports (sample)
- `Shell@packages/ax-code/src/shell/shell.ts:15`
- `killTree@packages/ax-code/src/shell/shell.ts:16`
- `isAcceptable@packages/ax-code/src/shell/shell.ts:63`
- `preferred@packages/ax-code/src/shell/shell.ts:93`
- `acceptable@packages/ax-code/src/shell/shell.ts:98`

### Tests
- `packages/ax-code/test/runtime/shell-env.test.ts`
- `packages/ax-code/test/session/prompt-shell-command.test.ts`
- `packages/ax-code/test/shell/shell.test.ts`
- `packages/ax-code/test/support/bun-shell.ts`
- `packages/ax-code/test/util/shell-args.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (5) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 1 source files; exports≈5
Step 2: Threat: secrets=0 files, processRisk=1 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/shell
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
| Static extract | ok fp `de00b2924e381514` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=1 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
