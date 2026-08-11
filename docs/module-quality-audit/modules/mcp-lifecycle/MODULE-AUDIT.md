# MODULE-AUDIT: mcp-lifecycle

| Field | Value |
|-------|-------|
| Unit slug | `mcp-lifecycle` |
| Scope | `packages/ax-code/src/mcp (lifecycle/transport)` |
| Resolved root | `packages/ax-code/src/mcp` |
| XL filter | yes |
| Wave / effort | Wave 5 / L |
| Risk tags | security, process |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `3cf8896b34612adc` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 5 / 2106 |
| Inventory ID | W5-05a |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/mcp/constants.ts` | 3 | 1 | 0 | 0 |
| `packages/ax-code/src/mcp/discovery.ts` | 323 | 7 | 0 | 0 |
| `packages/ax-code/src/mcp/impl.ts` | 1554 | 34 | 0 | 0 |
| `packages/ax-code/src/mcp/index.ts` | 2 | 0 | 0 | 0 |
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
- `MCP@packages/ax-code/src/mcp/impl.ts:38`
- `Resource@packages/ax-code/src/mcp/impl.ts:87`
- `Resource@packages/ax-code/src/mcp/impl.ts:96`
- `ReadResourceResult@packages/ax-code/src/mcp/impl.ts:103`
- `ReadResourceResult@packages/ax-code/src/mcp/impl.ts:118`
- `ToolsChanged@packages/ax-code/src/mcp/impl.ts:120`
- `BrowserOpenFailed@packages/ax-code/src/mcp/impl.ts:127`
- `Failed@packages/ax-code/src/mcp/impl.ts:135`
- `Status@packages/ax-code/src/mcp/impl.ts:144`
- `Status@packages/ax-code/src/mcp/impl.ts:200`
- `isConfigured@packages/ax-code/src/mcp/impl.ts:306`
- `add@packages/ax-code/src/mcp/impl.ts:487`

### Tests
- `packages/ax-code/test/bug-reports/lifecycle-visibility.test.ts`
- `packages/ax-code/test/cli/mcp-config-lock.test.ts`
- `packages/ax-code/test/cli/mcp-debug.test.ts`
- `packages/ax-code/test/cli/run-lifecycle.test.ts`
- `packages/ax-code/test/cli/tui/lifecycle-crash-handler.test.ts`
- `packages/ax-code/test/cli/tui/lifecycle.test.ts`
- `packages/ax-code/test/cli/tui/m-startup-lifecycle.test.ts`
- `packages/ax-code/test/cli/tui/sync-lifecycle.test.ts`
- `packages/ax-code/test/hooks/lifecycle.test.ts`
- `packages/ax-code/test/mcp/auth.test.ts`
- `packages/ax-code/test/mcp/connect-lock.test.ts`
- `packages/ax-code/test/mcp/discovery-playwright.test.ts`
- `packages/ax-code/test/mcp/discovery-spawn.test.ts`
- `packages/ax-code/test/mcp/headers.test.ts`
- `packages/ax-code/test/mcp/oauth-auto-connect.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (48) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,process | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `3cf8896b34612adc` |
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
