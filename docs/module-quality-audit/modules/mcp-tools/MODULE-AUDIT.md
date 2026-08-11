# MODULE-AUDIT: mcp-tools

| Field | Value |
|-------|-------|
| Unit slug | `mcp-tools` |
| Scope | `packages/ax-code/src/mcp (tool conversion)` |
| Resolved root | `packages/ax-code/src/mcp` |
| XL filter | yes |
| Wave / effort | Wave 5 / M |
| Risk tags | security |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `3ca417d0c6426885` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 3 / 513 |
| Inventory ID | W5-05c |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/mcp/permission-pattern.ts` | 163 | 3 | 0 | 0 |
| `packages/ax-code/src/mcp/templates/index.ts` | 224 | 6 | 0 | 0 |
| `packages/ax-code/src/mcp/tool-conversion.ts` | 126 | 8 | 0 | 0 |

### Exports (sample)
- `McpPermissionPattern@packages/ax-code/src/mcp/permission-pattern.ts:92`
- `Result@packages/ax-code/src/mcp/permission-pattern.ts:93`
- `derive@packages/ax-code/src/mcp/permission-pattern.ts:100`
- `McpTemplate@packages/ax-code/src/mcp/templates/index.ts:9`
- `TEMPLATES@packages/ax-code/src/mcp/templates/index.ts:23`
- `byCategory@packages/ax-code/src/mcp/templates/index.ts:171`
- `find@packages/ax-code/src/mcp/templates/index.ts:183`
- `names@packages/ax-code/src/mcp/templates/index.ts:190`
- `toConfig@packages/ax-code/src/mcp/templates/index.ts:206`
- `ConvertedMcpTool@packages/ax-code/src/mcp/tool-conversion.ts:12`
- `sanitizeMcpName@packages/ax-code/src/mcp/tool-conversion.ts:14`
- `mcpItemKey@packages/ax-code/src/mcp/tool-conversion.ts:18`
- `mcpToolPermissionKey@packages/ax-code/src/mcp/tool-conversion.ts:22`
- `McpToolIdentity@packages/ax-code/src/mcp/tool-conversion.ts:26`
- `resolveMcpToolPermissionKeys@packages/ax-code/src/mcp/tool-conversion.ts:33`
- `mcpSchemaByteLength@packages/ax-code/src/mcp/tool-conversion.ts:75`
- `convertMcpTool@packages/ax-code/src/mcp/tool-conversion.ts:83`

### Tests
- `packages/ax-code/test/cli/mcp-config-lock.test.ts`
- `packages/ax-code/test/cli/mcp-debug.test.ts`
- `packages/ax-code/test/mcp/auth.test.ts`
- `packages/ax-code/test/mcp/connect-lock.test.ts`
- `packages/ax-code/test/mcp/discovery-playwright.test.ts`
- `packages/ax-code/test/mcp/discovery-spawn.test.ts`
- `packages/ax-code/test/mcp/headers.test.ts`
- `packages/ax-code/test/mcp/oauth-auto-connect.test.ts`
- `packages/ax-code/test/mcp/oauth-browser.test.ts`
- `packages/ax-code/test/mcp/oauth-callback.test.ts`
- `packages/ax-code/test/mcp/permission-contract.test.ts`
- `packages/ax-code/test/mcp/permission-pattern.test.ts`
- `packages/ax-code/test/mcp/templates.test.ts`
- `packages/ax-code/test/mcp/tool-conversion.test.ts`
- `packages/ax-code/test/mcp/trust.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (17) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 3 source files; exports≈17
Step 2: Threat: secrets=2 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/mcp (tool conversion)
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
| Static extract | ok fp `3ca417d0c6426885` |
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
