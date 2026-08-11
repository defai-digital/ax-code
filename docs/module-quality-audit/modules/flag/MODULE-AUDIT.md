# MODULE-AUDIT: flag

| Field | Value |
|-------|-------|
| Unit slug | `flag` |
| Scope | `packages/ax-code/src/flag` |
| Resolved root | `packages/ax-code/src/flag` |
| XL filter | no |
| Wave / effort | Wave 10 / S |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | ax-code-glm |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `15eab9799edd83b7` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 2 / 477 |
| Inventory ID | W10-02 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/flag/flag.ts` | 385 | 50 | 0 | 0 |
| `packages/ax-code/src/flag/scoped.ts` | 92 | 9 | 0 | 0 |

### Exports (sample)
- `parsePositiveIntegerFlagValue@packages/ax-code/src/flag/flag.ts:45`
- `Flag@packages/ax-code/src/flag/flag.ts:53`
- `AX_CODE_GIT_BASH_PATH@packages/ax-code/src/flag/flag.ts:54`
- `AX_CODE_CONFIG@packages/ax-code/src/flag/flag.ts:55`
- `AX_CODE_DISABLE_AUTOUPDATE@packages/ax-code/src/flag/flag.ts:59`
- `AX_CODE_ALWAYS_NOTIFY_UPDATE@packages/ax-code/src/flag/flag.ts:60`
- `AX_CODE_DISABLE_PRUNE@packages/ax-code/src/flag/flag.ts:61`
- `AX_CODE_DISABLE_TERMINAL_TITLE@packages/ax-code/src/flag/flag.ts:62`
- `AX_CODE_TUI_ADVANCED_TERMINAL@packages/ax-code/src/flag/flag.ts:66`
- `AX_CODE_PERMISSION@packages/ax-code/src/flag/flag.ts:67`
- `AX_CODE_DISABLE_DEFAULT_PLUGINS@packages/ax-code/src/flag/flag.ts:68`
- `AX_CODE_DISABLE_LSP_DOWNLOAD@packages/ax-code/src/flag/flag.ts:69`
- `AX_CODE_ENABLE_EXPERIMENTAL_MODELS@packages/ax-code/src/flag/flag.ts:70`
- `AX_CODE_DISABLE_AUTOCOMPACT@packages/ax-code/src/flag/flag.ts:71`
- `AX_CODE_DISABLE_MODELS_FETCH@packages/ax-code/src/flag/flag.ts:72`
- `AX_CODE_DISABLE_CLAUDE_CODE@packages/ax-code/src/flag/flag.ts:73`
- `AX_CODE_DISABLE_CLAUDE_CODE_PROMPT@packages/ax-code/src/flag/flag.ts:74`
- `AX_CODE_DISABLE_CLAUDE_CODE_SKILLS@packages/ax-code/src/flag/flag.ts:76`
- `AX_CODE_DISABLE_EXTERNAL_SKILLS@packages/ax-code/src/flag/flag.ts:78`
- `AX_CODE_FAKE_VCS@packages/ax-code/src/flag/flag.ts:96`

### Tests
- `packages/ax-code/test/cli/tui/network-flags.test.ts`
- `packages/ax-code/test/flag/flag.test.ts`
- `packages/ax-code/test/flag/scoped.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (59) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags quality | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 2 source files; exports≈99
Step 2: Threat: secrets=1 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/flag
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
| Static extract | ok fp `15eab9799edd83b7` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=2 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
