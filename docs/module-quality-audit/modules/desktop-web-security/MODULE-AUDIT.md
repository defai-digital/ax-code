# MODULE-AUDIT: desktop-web-security

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-security` |
| Scope | `desktop/packages/web/server/lib/security` |
| Resolved root | `desktop/packages/web/server/lib/security` |
| XL filter | no |
| Wave / effort | Wave 1 / M |
| Risk tags | security, desktop |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `bb54d5098dd0e47b` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 9 / 508 |
| Inventory ID | W1-15 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/security/legacy-tunnel.js` | 59 | 1 | 2 | 0 |
| `desktop/packages/web/server/lib/security/legacy-tunnel.test.js` | 62 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/security/local-only.js` | 32 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/security/request-origin.js` | 55 | 6 | 0 | 0 |
| `desktop/packages/web/server/lib/security/request-origin.test.js` | 35 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/security/request-security.js` | 89 | 1 | 2 | 0 |
| `desktop/packages/web/server/lib/security/request-security.test.js` | 106 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/security/response-headers.js` | 31 | 3 | 0 | 0 |
| `desktop/packages/web/server/lib/security/response-headers.test.js` | 39 | 0 | 0 | 0 |

### Exports (sample)
- `assertNoActiveLegacyPublicTunnels@desktop/packages/web/server/lib/security/legacy-tunnel.js:15`
- `normalizeLoopbackHostname@desktop/packages/web/server/lib/security/local-only.js:1`
- `isLoopbackHostname@desktop/packages/web/server/lib/security/local-only.js:6`
- `assertLocalOnlyHostname@desktop/packages/web/server/lib/security/local-only.js:14`
- `normalizeLoopbackHttpOrigin@desktop/packages/web/server/lib/security/local-only.js:21`
- `isLoopbackHttpUrl@desktop/packages/web/server/lib/security/local-only.js:31`
- `firstForwardedHeaderValue@desktop/packages/web/server/lib/security/request-origin.js:3`
- `getRequestProtocol@desktop/packages/web/server/lib/security/request-origin.js:6`
- `getRequestHost@desktop/packages/web/server/lib/security/request-origin.js:10`
- `getRequestOrigin@desktop/packages/web/server/lib/security/request-origin.js:14`
- `getRequestRpId@desktop/packages/web/server/lib/security/request-origin.js:25`
- `addLocalhostOriginAliases@desktop/packages/web/server/lib/security/request-origin.js:38`
- `createRequestSecurityRuntime@desktop/packages/web/server/lib/security/request-security.js:4`
- `isPreviewProxyRequest@desktop/packages/web/server/lib/security/response-headers.js:9`
- `isDashboardProxyRequest@desktop/packages/web/server/lib/security/response-headers.js:14`
- `applySecurityHeaders@desktop/packages/web/server/lib/security/response-headers.js:19`

### Tests
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/runtime/listen-security.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (16) | static map |
| Silent failure | empty catch (4) | per-site disposition in findings |
| Secrets/process/IO | risk tags security,desktop | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-security-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `bb54d5098dd0e47b` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=15 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
