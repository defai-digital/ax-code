# MODULE-AUDIT: tool-network

| Field | Value |
|-------|-------|
| Unit slug | `tool-network` |
| Scope | `packages/ax-code/src/tool (webfetch/browser/network)` |
| Resolved root | `packages/ax-code/src/tool` |
| XL filter | yes |
| Wave / effort | Wave 3 / M |
| Risk tags | security, network |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `2300e394ebe8b438` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 11 / 1552 |
| Inventory ID | W3-03c |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/tool/browser/action.ts` | 58 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/browser/capture.ts` | 47 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/browser/console.ts` | 37 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/browser/evaluate.ts` | 33 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/browser/network.ts` | 52 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/browser/open.ts` | 50 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/browser/runtime.ts` | 678 | 8 | 0 | 0 |
| `packages/ax-code/src/tool/browser/snapshot.ts` | 29 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/exa-fetch.ts` | 150 | 3 | 0 | 0 |
| `packages/ax-code/src/tool/webfetch.ts` | 335 | 1 | 1 | 0 |
| `packages/ax-code/src/tool/websearch.ts` | 83 | 1 | 0 | 0 |

### Exports (sample)
- `BrowserActionTool@packages/ax-code/src/tool/browser/action.ts:7`
- `BrowserCaptureTool@packages/ax-code/src/tool/browser/capture.ts:6`
- `BrowserConsoleTool@packages/ax-code/src/tool/browser/console.ts:6`
- `BrowserEvaluateTool@packages/ax-code/src/tool/browser/evaluate.ts:6`
- `BrowserNetworkTool@packages/ax-code/src/tool/browser/network.ts:6`
- `BrowserOpenTool@packages/ax-code/src/tool/browser/open.ts:7`
- `BrowserPage@packages/ax-code/src/tool/browser/runtime.ts:22`
- `BrowserSnapshot@packages/ax-code/src/tool/browser/runtime.ts:29`
- `BrowserScreenshot@packages/ax-code/src/tool/browser/runtime.ts:35`
- `BrowserConsoleMessage@packages/ax-code/src/tool/browser/runtime.ts:43`
- `BrowserNetworkRequest@packages/ax-code/src/tool/browser/runtime.ts:49`
- `_resetPlaywrightCache@packages/ax-code/src/tool/browser/runtime.ts:87`
- `_setPlaywrightForTest@packages/ax-code/src/tool/browser/runtime.ts:93`
- `BrowserRuntime@packages/ax-code/src/tool/browser/runtime.ts:195`
- `BrowserSnapshotTool@packages/ax-code/src/tool/browser/snapshot.ts:6`
- `decodeExaMcpContentText@packages/ax-code/src/tool/exa-fetch.ts:25`
- `parseExaSseContentText@packages/ax-code/src/tool/exa-fetch.ts:30`
- `fetchExaTool@packages/ax-code/src/tool/exa-fetch.ts:40`
- `WebFetchTool@packages/ax-code/src/tool/webfetch.ts:23`
- `WebSearchTool@packages/ax-code/src/tool/websearch.ts:8`

### Tests
- `packages/ax-code/test/cli/network.test.ts`
- `packages/ax-code/test/cli/tui/network-flags.test.ts`
- `packages/ax-code/test/cli/tui/session-tool-rendering.test.ts`
- `packages/ax-code/test/mcp/tool-conversion.test.ts`
- `packages/ax-code/test/replay/tool-call-query.test.ts`
- `packages/ax-code/test/replay/tool-result-metadata.test.ts`
- `packages/ax-code/test/session/prompt-tools.test.ts`
- `packages/ax-code/test/session/tool-error-pattern.test.ts`
- `packages/ax-code/test/tool/apply_patch.test.ts`
- `packages/ax-code/test/tool/arena-implement.test.ts`
- `packages/ax-code/test/tool/arena-tool.test.ts`
- `packages/ax-code/test/tool/arena.test.ts`
- `packages/ax-code/test/tool/bash-background.test.ts`
- `packages/ax-code/test/tool/bash-destructive.test.ts`
- `packages/ax-code/test/tool/bash-helpers.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (20) | static map |
| Silent failure | empty catch (1) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,network | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 11 source files; exports≈20
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=1
Step 3: Correctness: read control flow for public surfaces; findings=AUDIT-tool-network-empty-catch.md
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/tool (webfetch/browser/network)
Step 6: Hygiene: empty=1; notes: packages/ax-code/src/tool/webfetch.ts: 1 empty catch(es) — see empty-catch finding disposition
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-tool-network-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `2300e394ebe8b438` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=11 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
