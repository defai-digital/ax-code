# MODULE-AUDIT: mcp-discovery

| Field | Value |
|-------|-------|
| Unit slug | `mcp-discovery` |
| Scope | `packages/ax-code/src/mcp (discovery/config/disposal)` |
| Resolved root | `packages/ax-code/src/mcp` |
| XL filter | yes |
| Wave / effort | Wave 5 / M |
| Risk tags | security |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `0cf1bfbfd843f169` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 3 / 550 |
| Inventory ID | W5-05d |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/mcp/constants.ts` | 3 | 1 | 0 | 0 |
| `packages/ax-code/src/mcp/discovery.ts` | 323 | 7 | 0 | 0 |
| `packages/ax-code/src/mcp/templates/index.ts` | 224 | 6 | 0 | 0 |

### Exports (sample)
- `MCP_DEFAULT_TIMEOUT_MS@packages/ax-code/src/mcp/constants.ts:2`
- `spawnExitsCleanly@packages/ax-code/src/mcp/discovery.ts:41`
- `checkTcpPort@packages/ax-code/src/mcp/discovery.ts:70`
- `isHtmlOrWebProject@packages/ax-code/src/mcp/discovery.ts:94`
- `DiscoveredServer@packages/ax-code/src/mcp/discovery.ts:122`
- `discoverPlaywrightCandidate@packages/ax-code/src/mcp/discovery.ts:155`
- `discover@packages/ax-code/src/mcp/discovery.ts:273`
- `available@packages/ax-code/src/mcp/discovery.ts:319`
- `McpTemplate@packages/ax-code/src/mcp/templates/index.ts:9`
- `TEMPLATES@packages/ax-code/src/mcp/templates/index.ts:23`
- `byCategory@packages/ax-code/src/mcp/templates/index.ts:171`
- `find@packages/ax-code/src/mcp/templates/index.ts:183`
- `names@packages/ax-code/src/mcp/templates/index.ts:190`
- `toConfig@packages/ax-code/src/mcp/templates/index.ts:206`

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
| Module contract | public exports (14) | static map |
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
| Static extract | ok fp `0cf1bfbfd843f169` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=13 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
