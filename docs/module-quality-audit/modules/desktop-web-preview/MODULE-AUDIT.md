# MODULE-AUDIT: desktop-web-preview

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-preview` |
| Scope | `desktop/packages/web/server/lib/preview` |
| Resolved root | `desktop/packages/web/server/lib/preview` |
| XL filter | no |
| Wave / effort | Wave 7 / M |
| Risk tags | desktop, security |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `fb8dac3b5be4143a` |
| Protocol marker | pending dual-agent 9-step |
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

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-preview-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `fb8dac3b5be4143a` |
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
