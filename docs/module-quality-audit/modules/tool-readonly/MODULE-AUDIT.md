# MODULE-AUDIT: tool-readonly

| Field | Value |
|-------|-------|
| Unit slug | `tool-readonly` |
| Scope | `packages/ax-code/src/tool (read/grep/glob/ls)` |
| Resolved root | `packages/ax-code/src/tool` |
| XL filter | yes |
| Wave / effort | Wave 3 / M |
| Risk tags | correctness |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `b12e810be8830e4e` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 7 / 1540 |
| Inventory ID | W3-03e |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/tool/codesearch.ts` | 59 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/glob.ts` | 142 | 3 | 0 | 0 |
| `packages/ax-code/src/tool/grep.ts` | 299 | 4 | 0 | 0 |
| `packages/ax-code/src/tool/ls.ts` | 181 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/lsp.ts` | 378 | 2 | 0 | 0 |
| `packages/ax-code/src/tool/read.ts` | 398 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/websearch.ts` | 83 | 1 | 0 | 0 |

### Exports (sample)
- `CodeSearchTool@packages/ax-code/src/tool/codesearch.ts:7`
- `NativeGlobEntry@packages/ax-code/src/tool/glob.ts:24`
- `parseNativeGlobEntries@packages/ax-code/src/tool/glob.ts:26`
- `GlobTool@packages/ax-code/src/tool/glob.ts:30`
- `NativeSearchMatch@packages/ax-code/src/tool/grep.ts:26`
- `parseNativeSearchMatches@packages/ax-code/src/tool/grep.ts:28`
- `parseRipgrepLineNumber@packages/ax-code/src/tool/grep.ts:32`
- `GrepTool@packages/ax-code/src/tool/grep.ts:41`
- `ListTool@packages/ax-code/src/tool/ls.ts:99`
- `normalizeLspToolEnvelopeData@packages/ax-code/src/tool/lsp.ts:33`
- `LspTool@packages/ax-code/src/tool/lsp.ts:78`
- `ReadTool@packages/ax-code/src/tool/read.ts:71`
- `WebSearchTool@packages/ax-code/src/tool/websearch.ts:8`

### Tests
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
- `packages/ax-code/test/tool/bash.test.ts`
- `packages/ax-code/test/tool/batch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (13) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags correctness | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `b12e810be8830e4e` |
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
