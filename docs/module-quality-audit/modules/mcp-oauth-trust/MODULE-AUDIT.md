# MODULE-AUDIT: mcp-oauth-trust

| Field | Value |
|-------|-------|
| Unit slug | `mcp-oauth-trust` |
| Scope | `packages/ax-code/src/mcp (OAuth/trust)` |
| Resolved root | `packages/ax-code/src/mcp` |
| XL filter | yes |
| Wave / effort | Wave 5 / L |
| Risk tags | security |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `ee8c6ebcca798252` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 4 / 932 |
| Inventory ID | W5-05b |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/mcp/auth.ts` | 255 | 24 | 0 | 0 |
| `packages/ax-code/src/mcp/oauth-callback.ts` | 292 | 8 | 0 | 0 |
| `packages/ax-code/src/mcp/oauth-provider.ts` | 210 | 5 | 0 | 0 |
| `packages/ax-code/src/mcp/trust.ts` | 175 | 6 | 0 | 0 |

### Exports (sample)
- `McpAuth@packages/ax-code/src/mcp/auth.ts:8`
- `Tokens@packages/ax-code/src/mcp/auth.ts:9`
- `Tokens@packages/ax-code/src/mcp/auth.ts:15`
- `ClientInfo@packages/ax-code/src/mcp/auth.ts:17`
- `ClientInfo@packages/ax-code/src/mcp/auth.ts:23`
- `Entry@packages/ax-code/src/mcp/auth.ts:25`
- `Entry@packages/ax-code/src/mcp/auth.ts:32`
- `withLock@packages/ax-code/src/mcp/auth.ts:49`
- `get@packages/ax-code/src/mcp/auth.ts:88`
- `getForUrl@packages/ax-code/src/mcp/auth.ts:97`
- `all@packages/ax-code/src/mcp/auth.ts:110`
- `set@packages/ax-code/src/mcp/auth.ts:137`
- `remove@packages/ax-code/src/mcp/auth.ts:148`
- `updateTokens@packages/ax-code/src/mcp/auth.ts:156`
- `updateClientInfo@packages/ax-code/src/mcp/auth.ts:165`
- `updateCodeVerifier@packages/ax-code/src/mcp/auth.ts:174`
- `clearCodeVerifier@packages/ax-code/src/mcp/auth.ts:185`
- `updateOAuthState@packages/ax-code/src/mcp/auth.ts:192`
- `getOAuthState@packages/ax-code/src/mcp/auth.ts:198`
- `clearOAuthState@packages/ax-code/src/mcp/auth.ts:203`

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
| Module contract | public exports (43) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `ee8c6ebcca798252` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=9 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
