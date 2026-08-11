# MODULE-AUDIT: config

| Field | Value |
|-------|-------|
| Unit slug | `config` |
| Scope | `packages/ax-code/src/config` |
| Resolved root | `packages/ax-code/src/config` |
| XL filter | no |
| Wave / effort | Wave 1 / L |
| Risk tags | security, config |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `cab6c0089e3b7b3410f050bc9d824c06a3c3a814` |
| Analysis fingerprint | `4bd420d1bfab0da8` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 11 / 3723 |
| Inventory ID | W1-03 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/config/config-impl.ts` | 1560 | 55 | 1 | 0 |
| `packages/ax-code/src/config/config.ts` | 2 | 0 | 0 | 0 |
| `packages/ax-code/src/config/markdown.ts` | 171 | 9 | 0 | 0 |
| `packages/ax-code/src/config/migrate-tui-config.ts` | 180 | 1 | 0 | 0 |
| `packages/ax-code/src/config/migration.ts` | 208 | 12 | 0 | 0 |
| `packages/ax-code/src/config/paths.ts` | 300 | 10 | 0 | 0 |
| `packages/ax-code/src/config/project-config-trust.ts` | 14 | 3 | 0 | 0 |
| `packages/ax-code/src/config/schema-impl.ts` | 1085 | 34 | 0 | 0 |
| `packages/ax-code/src/config/schema.ts` | 2 | 0 | 0 | 0 |
| `packages/ax-code/src/config/tui-schema.ts` | 35 | 2 | 0 | 0 |
| `packages/ax-code/src/config/tui.ts` | 166 | 4 | 0 | 0 |

### Exports (sample)
- `Config@packages/ax-code/src/config/config-impl.ts:81`
- `McpSourceKind@packages/ax-code/src/config/config-impl.ts:202`
- `McpSourceKind@packages/ax-code/src/config/config-impl.ts:214`
- `McpSource@packages/ax-code/src/config/config-impl.ts:215`
- `McpSource@packages/ax-code/src/config/config-impl.ts:221`
- `trustedMcpSource@packages/ax-code/src/config/config-impl.ts:223`
- `PermissionEnvParseResult@packages/ax-code/src/config/config-impl.ts:239`
- `decodePermissionEnvValue@packages/ax-code/src/config/config-impl.ts:254`
- `parsePermissionEnv@packages/ax-code/src/config/config-impl.ts:264`
- `managedConfigDir@packages/ax-code/src/config/config-impl.ts:286`
- `state@packages/ax-code/src/config/config-impl.ts:314`
- `waitForDependencies@packages/ax-code/src/config/config-impl.ts:749`
- `installDependencies@packages/ax-code/src/config/config-impl.ts:762`
- `needsInstall@packages/ax-code/src/config/config-impl.ts:879`
- `getPluginName@packages/ax-code/src/config/config-impl.ts:1154`
- `deduplicatePlugins@packages/ax-code/src/config/config-impl.ts:1180`
- `McpLocal@packages/ax-code/src/config/config-impl.ts:1201`
- `McpOAuth@packages/ax-code/src/config/config-impl.ts:1202`
- `McpOAuth@packages/ax-code/src/config/config-impl.ts:1203`
- `McpRemote@packages/ax-code/src/config/config-impl.ts:1204`

### Tests
- `packages/ax-code/test/cli/github-agent-git-config.test.ts`
- `packages/ax-code/test/cli/mcp-config-lock.test.ts`
- `packages/ax-code/test/cli/tui/k-tui-config-salvage.test.ts`
- `packages/ax-code/test/config/agent-color.test.ts`
- `packages/ax-code/test/config/config.test.ts`
- `packages/ax-code/test/config/markdown.test.ts`
- `packages/ax-code/test/config/permission-env.test.ts`
- `packages/ax-code/test/config/tui.test.ts`
- `packages/ax-code/test/lsp/server-config.test.ts`
- `packages/ax-code/test/server/global-config.test.ts`
- `packages/ax-code/test/server/project-config.test.ts`
- `packages/ax-code/test/session/prompt-loop-config.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (130) | static map |
| Silent failure | empty catch (1) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,config | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-config-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `4bd420d1bfab0da8` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=19 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
