# MODULE-AUDIT: constants

| Field | Value |
|-------|-------|
| Unit slug | `constants` |
| Scope | `packages/ax-code/src/constants` |
| Resolved root | `packages/ax-code/src/constants` |
| XL filter | no |
| Wave / effort | Wave 10 / S |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | ax-code-glm |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `3216022cdaef2a17` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 7 / 173 |
| Inventory ID | W10-01 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/constants/index.ts` | 6 | 0 | 0 | 0 |
| `packages/ax-code/src/constants/lsp.ts` | 2 | 1 | 0 | 0 |
| `packages/ax-code/src/constants/network.ts` | 8 | 7 | 0 | 0 |
| `packages/ax-code/src/constants/project.ts` | 43 | 13 | 0 | 0 |
| `packages/ax-code/src/constants/server.ts` | 6 | 3 | 0 | 0 |
| `packages/ax-code/src/constants/session.ts` | 99 | 14 | 0 | 0 |
| `packages/ax-code/src/constants/tool.ts` | 9 | 8 | 0 | 0 |

### Exports (sample)
- `JS_LOCKFILES@packages/ax-code/src/constants/lsp.ts:1`
- `WEBFETCH_MAX_RESPONSE_SIZE@packages/ax-code/src/constants/network.ts:1`
- `WEBFETCH_DEFAULT_TIMEOUT@packages/ax-code/src/constants/network.ts:2`
- `WEBFETCH_MAX_TIMEOUT@packages/ax-code/src/constants/network.ts:3`
- `BASH_MAX_METADATA_LENGTH@packages/ax-code/src/constants/network.ts:4`
- `EXA_BASE_URL@packages/ax-code/src/constants/network.ts:5`
- `EXA_ENDPOINT@packages/ax-code/src/constants/network.ts:6`
- `EXA_DEFAULT_NUM_RESULTS@packages/ax-code/src/constants/network.ts:7`
- `GITHUB_ORG@packages/ax-code/src/constants/project.ts:8`
- `PACKAGE_NAME@packages/ax-code/src/constants/project.ts:9`
- `GITHUB_REPO_SLUG@packages/ax-code/src/constants/project.ts:12`
- `GITHUB_REPO_URL@packages/ax-code/src/constants/project.ts:15`
- `GITHUB_NEW_ISSUE_URL@packages/ax-code/src/constants/project.ts:18`
- `GITHUB_LATEST_RELEASE_API_URL@packages/ax-code/src/constants/project.ts:21`
- `GITHUB_ACTION_REF@packages/ax-code/src/constants/project.ts:24`
- `CONFIG_SCHEMA_URL@packages/ax-code/src/constants/project.ts:30`
- `TUI_SCHEMA_URL@packages/ax-code/src/constants/project.ts:33`
- `INSTALL_SCRIPT_URL@packages/ax-code/src/constants/project.ts:36`
- `HOMEBREW_TAP@packages/ax-code/src/constants/project.ts:40`
- `LEGACY_HOMEBREW_TAP@packages/ax-code/src/constants/project.ts:41`

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (46) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags quality | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 7 source files; exports≈51
Step 2: Threat: secrets=1 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/constants
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
| Static extract | ok fp `3216022cdaef2a17` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=7 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
