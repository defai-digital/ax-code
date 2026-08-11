# MODULE-AUDIT: desktop-web-preview

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-preview` |
| Scope | `desktop/packages/web/server/lib/preview` |
| Resolved root | `desktop/packages/web/server/lib/preview` |
| XL filter | no |
| Wave / effort | Wave 7 / M |
| Risk tags | desktop, security |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `cab6c0089e3b7b3410f050bc9d824c06a3c3a814` |
| Analysis fingerprint | `fb8dac3b5be4143a` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 2 / 1903 |
| Inventory ID | W7-14 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/preview/proxy-runtime.js` | 1520 | 7 | 9 | 0 |
| `desktop/packages/web/server/lib/preview/proxy-runtime.test.js` | 383 | 0 | 0 | 0 |

### Exports (sample)
- `classifyPreviewResourceError@desktop/packages/web/server/lib/preview/proxy-runtime.js:101`
- `classifyPreviewNavigation@desktop/packages/web/server/lib/preview/proxy-runtime.js:115`
- `buildPreviewProxyUpstreamPath@desktop/packages/web/server/lib/preview/proxy-runtime.js:872`
- `removeSensitivePreviewProxyHeaders@desktop/packages/web/server/lib/preview/proxy-runtime.js:878`
- `normalizeProxyTargetUrl@desktop/packages/web/server/lib/preview/proxy-runtime.js:924`
- `rewritePreviewBody@desktop/packages/web/server/lib/preview/proxy-runtime.js:965`
- `createPreviewProxyRuntime@desktop/packages/web/server/lib/preview/proxy-runtime.js:1045`

### Tests
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (7) | static map |
| Silent failure | empty catch (9) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop,security | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-preview-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `fb8dac3b5be4143a` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=7 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
