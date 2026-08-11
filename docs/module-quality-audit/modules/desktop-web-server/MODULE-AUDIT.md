# MODULE-AUDIT: desktop-web-server

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-server` |
| Scope | `desktop/packages/web/server` |
| Resolved root | `desktop/packages/web/server` |
| XL filter | no |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop, network |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `0be0e0a6cdb75c03` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 228 / 51803 |
| Inventory ID | W7-05 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/ax-code-proxy.test.js` | 482 | 0 | 0 | 0 |
| `desktop/packages/web/server/index.d.ts` | 41 | 2 | 0 | 0 |
| `desktop/packages/web/server/index.js` | 1435 | 0 | 1 | 0 |
| `desktop/packages/web/server/lib/ax-code/agents.js` | 582 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/auth-state-runtime.js` | 87 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/auth-state-runtime.test.js` | 61 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/auth.js` | 105 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/ax-code-resolution-runtime.js` | 70 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/background-reload.js` | 70 | 3 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/background-reload.test.js` | 103 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/bootstrap-runtime.js` | 107 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/cli-entry-runtime.js` | 27 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/cli-options.js` | 63 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/cli-options.test.js` | 46 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/commands.js` | 288 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/config-entity-routes.js` | 474 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/core-routes.js` | 515 | 4 | 7 | 0 |
| `desktop/packages/web/server/lib/ax-code/core-routes.test.js` | 266 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/env-config.js` | 82 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/env-config.test.js` | 64 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/env-runtime.js` | 1284 | 1 | 13 | 0 |
| `desktop/packages/web/server/lib/ax-code/env-runtime.test.js` | 283 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/feature-routes-runtime.js` | 309 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/hmr-state-runtime.js` | 70 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/hmr-state-runtime.test.js` | 51 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/index.js` | 74 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/lifecycle.js` | 1311 | 1 | 9 | 0 |
| `desktop/packages/web/server/lib/ax-code/lifecycle.test.js` | 446 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/managed-ax-code-runtime.js` | 27 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/managed-ax-code-runtime.test.js` | 28 | 0 | 0 | 0 |

### Exports (sample)
- `WebUiServerController@desktop/packages/web/server/index.d.ts:4`
- `StartWebUiServerOptions@desktop/packages/web/server/index.d.ts:21`
- `createAxCodeAuthStateRuntime@desktop/packages/web/server/lib/ax-code/auth-state-runtime.js:1`
- `createAxCodeResolutionRuntime@desktop/packages/web/server/lib/ax-code/ax-code-resolution-runtime.js:1`
- `DEFAULT_BACKGROUND_RELOAD_MIN_DELAY_MS@desktop/packages/web/server/lib/ax-code/background-reload.js:1`
- `DEFAULT_BACKGROUND_RELOAD_TIMEOUT_MS@desktop/packages/web/server/lib/ax-code/background-reload.js:2`
- `createBackgroundAxCodeReloader@desktop/packages/web/server/lib/ax-code/background-reload.js:10`
- `createBootstrapRuntime@desktop/packages/web/server/lib/ax-code/bootstrap-runtime.js:13`
- `runCliEntryIfMain@desktop/packages/web/server/lib/ax-code/cli-entry-runtime.js:1`
- `parseServeCliOptions@desktop/packages/web/server/lib/ax-code/cli-options.js:8`
- `registerConfigEntityRoutes@desktop/packages/web/server/lib/ax-code/config-entity-routes.js:1`
- `registerServerStatusRoutes@desktop/packages/web/server/lib/ax-code/core-routes.js:44`
- `registerAuthAndAccessRoutes@desktop/packages/web/server/lib/ax-code/core-routes.js:318`
- `registerSettingsUtilityRoutes@desktop/packages/web/server/lib/ax-code/core-routes.js:432`
- `registerCommonRequestMiddleware@desktop/packages/web/server/lib/ax-code/core-routes.js:469`
- `resolveAxCodeEnvConfig@desktop/packages/web/server/lib/ax-code/env-config.js:5`
- `createAxCodeEnvRuntime@desktop/packages/web/server/lib/ax-code/env-runtime.js:7`
- `createFeatureRoutesRuntime@desktop/packages/web/server/lib/ax-code/feature-routes-runtime.js:19`
- `createHmrStateRuntime@desktop/packages/web/server/lib/ax-code/hmr-state-runtime.js:1`
- `createAxCodeLifecycleRuntime@desktop/packages/web/server/lib/ax-code/lifecycle.js:25`

### Tests
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/control-plane/workspace-server-sse.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/lsp/server-config.test.ts`
- `packages/ax-code/test/lsp/server-defs.test.ts`
- `packages/ax-code/test/lsp/server-helpers.test.ts`
- `packages/ax-code/test/lsp/server-profile.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/server/app-context-routes.test.ts`
- `packages/ax-code/test/server/audit-route.test.ts`
- `packages/ax-code/test/server/capability.test.ts`
- `packages/ax-code/test/server/dre-graph.test.ts`
- `packages/ax-code/test/server/file-routes.test.ts`
- `packages/ax-code/test/server/global-capabilities.test.ts`
- `packages/ax-code/test/server/global-config.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (430) | static map |
| Silent failure | empty catch (87) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop,network | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-server-empty-catch | silent-error | Medium | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `0be0e0a6cdb75c03` |
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
