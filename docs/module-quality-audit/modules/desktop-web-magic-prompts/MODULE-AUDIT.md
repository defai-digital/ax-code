# MODULE-AUDIT: desktop-web-magic-prompts

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-magic-prompts` |
| Scope | `desktop/packages/web/server/lib/magic-prompts` |
| Resolved root | `desktop/packages/web/server/lib/magic-prompts` |
| XL filter | no |
| Wave / effort | Wave 7 / S |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `16e6a7201e088ef1` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 3 / 272 |
| Inventory ID | W7-12 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/magic-prompts/routes.js` | 63 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/magic-prompts/runtime.js` | 131 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/magic-prompts/runtime.test.js` | 78 | 0 | 0 | 0 |

### Exports (sample)
- `registerMagicPromptRoutes@desktop/packages/web/server/lib/magic-prompts/routes.js:3`
- `createMagicPromptRuntime@desktop/packages/web/server/lib/magic-prompts/runtime.js:35`

### Tests
- `packages/ax-code/test/cli/github-agent-prompts.test.ts`
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/session/debug-workflow-prompts.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (2) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 3 source files; exports≈2
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for desktop/packages/web/server/lib/magic-prompts
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
| Static extract | ok fp `16e6a7201e088ef1` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=3 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
