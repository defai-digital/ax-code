# MODULE-AUDIT: desktop-web-ui-auth

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-ui-auth` |
| Scope | `desktop/packages/web/server/lib/ui-auth` |
| Resolved root | `desktop/packages/web/server/lib/ui-auth` |
| XL filter | no |
| Wave / effort | Wave 1 / M |
| Risk tags | security, desktop |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `2a00cb2a2a72e1b5` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 4 / 1484 |
| Inventory ID | W1-16 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/ui-auth/ui-auth.js` | 650 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/ui-auth/ui-auth.test.js` | 112 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ui-auth/ui-passkeys.js` | 527 | 1 | 4 | 0 |
| `desktop/packages/web/server/lib/ui-auth/ui-passkeys.test.js` | 195 | 0 | 0 | 0 |

### Exports (sample)
- `derivePasswordBinding@desktop/packages/web/server/lib/ui-auth/ui-auth.js:261`
- `createUiAuth@desktop/packages/web/server/lib/ui-auth/ui-auth.js:309`
- `createUiPasskeys@desktop/packages/web/server/lib/ui-auth/ui-passkeys.js:72`

### Tests
- `packages/ax-code/test/auth/auth.test.ts`
- `packages/ax-code/test/auth/encryption.test.ts`
- `packages/ax-code/test/cli/plugin-auth-picker.test.ts`
- `packages/ax-code/test/cli/tui/c-dialog-provider-auth-errors.test.ts`
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/auth.ts`
- `packages/ax-code/test/mcp/auth.test.ts`
- `packages/ax-code/test/mcp/oauth-auto-connect.test.ts`
- `packages/ax-code/test/mcp/oauth-browser.test.ts`
- `packages/ax-code/test/mcp/oauth-callback.test.ts`
- `packages/ax-code/test/plugin/auth-override.test.ts`
- `packages/ax-code/test/provider/xai/auth-plugin.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (3) | static map |
| Silent failure | empty catch (4) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,desktop | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-ui-auth-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `2a00cb2a2a72e1b5` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=4 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
