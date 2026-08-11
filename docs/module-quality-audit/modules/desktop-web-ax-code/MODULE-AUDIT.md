# MODULE-AUDIT: desktop-web-ax-code

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-ax-code` |
| Scope | `desktop/packages/web/server/lib/ax-code` |
| Resolved root | `desktop/packages/web/server/lib/ax-code` |
| XL filter | no |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `c30d09200bea6d31` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 84 / 20115 |
| Inventory ID | W7-06 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
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
| `desktop/packages/web/server/lib/ax-code/mcp.js` | 263 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/network-runtime.js` | 104 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/network-runtime.test.js` | 42 | 0 | 0 | 0 |

### Exports (sample)
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
- `createManagedAxCodeRuntimeAdapter@desktop/packages/web/server/lib/ax-code/managed-ax-code-runtime.js:8`
- `createAxCodeNetworkRuntime@desktop/packages/web/server/lib/ax-code/network-runtime.js:1`

### Tests
- `packages/ax-code/test/account/repo.test.ts`
- `packages/ax-code/test/account/service.test.ts`
- `packages/ax-code/test/account/token-decode.test.ts`
- `packages/ax-code/test/acp/agent-adapter.test.ts`
- `packages/ax-code/test/acp/agent-interface.test.ts`
- `packages/ax-code/test/acp/agent-prompt.test.ts`
- `packages/ax-code/test/acp/event-subscription.test.ts`
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/acp/session-list.test.ts`
- `packages/ax-code/test/acp/todo-plan-entries.test.ts`
- `packages/ax-code/test/agent/agent.test.ts`
- `packages/ax-code/test/agent/router.test.ts`
- `packages/ax-code/test/audit/bugfix.test.ts`
- `packages/ax-code/test/audit/json.test.ts`
- `packages/ax-code/test/audit/report.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (70) | static map |
| Silent failure | empty catch (37) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-ax-code-empty-catch | silent-error | Medium | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `c30d09200bea6d31` |
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
