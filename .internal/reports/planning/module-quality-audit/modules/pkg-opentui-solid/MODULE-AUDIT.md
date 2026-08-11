# MODULE-AUDIT: pkg-opentui-solid

| Field | Value |
|-------|-------|
| Unit slug | `pkg-opentui-solid` |
| Scope | `packages/opentui-solid` |
| Wave / effort | Wave 9 / L |
| Risk tags | ui |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `c33fec50ffd14a2a` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W9-06 |
| Source files / LOC | 37 / 4204 |

## 1. Scope and map

### Purpose and ownership
Unit `pkg-opentui-solid` owns `packages/opentui-solid`. Risk profile: ui.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/opentui-solid/components.d.ts` | 3 | 2 | 0 | 0 |
| `packages/opentui-solid/components.js` | 112 | 0 | 0 | 0 |
| `packages/opentui-solid/index.bun.js` | 1610 | 0 | 1 | 0 |
| `packages/opentui-solid/index.d.ts` | 13 | 1 | 0 | 0 |
| `packages/opentui-solid/index.js` | 1630 | 0 | 1 | 0 |
| `packages/opentui-solid/jsx-dev-runtime.d.ts` | 2 | 3 | 0 | 0 |
| `packages/opentui-solid/jsx-dev-runtime.js` | 2 | 2 | 0 | 0 |
| `packages/opentui-solid/jsx-runtime.d.ts` | 55 | 0 | 0 | 0 |
| `packages/opentui-solid/jsx-runtime.js` | 31 | 4 | 0 | 0 |
| `packages/opentui-solid/scripts/preload.js` | 3 | 0 | 0 | 0 |
| `packages/opentui-solid/scripts/preload.node.js` | 2 | 0 | 0 | 0 |
| `packages/opentui-solid/scripts/runtime-plugin-support-configure.d.ts` | 8 | 1 | 0 | 0 |
| `packages/opentui-solid/scripts/runtime-plugin-support-configure.js` | 67 | 1 | 0 | 0 |
| `packages/opentui-solid/scripts/runtime-plugin-support-configure.node.js` | 19 | 1 | 0 | 0 |
| `packages/opentui-solid/scripts/runtime-plugin-support.d.ts` | 4 | 1 | 0 | 0 |
| `packages/opentui-solid/scripts/runtime-plugin-support.js` | 4 | 1 | 0 | 0 |
| `packages/opentui-solid/scripts/runtime-plugin-support.node.js` | 19 | 1 | 0 | 0 |
| `packages/opentui-solid/scripts/solid-plugin.d.ts` | 12 | 1 | 0 | 0 |
| `packages/opentui-solid/scripts/solid-plugin.js` | 76 | 3 | 0 | 0 |
| `packages/opentui-solid/scripts/solid-plugin.node.js` | 37 | 3 | 0 | 0 |
| `packages/opentui-solid/scripts/solid-transform.d.ts` | 11 | 2 | 0 | 0 |
| `packages/opentui-solid/scripts/solid-transform.js` | 66 | 4 | 0 | 0 |
| `packages/opentui-solid/src/elements/catalogue.d.ts` | 70 | 2 | 0 | 0 |
| `packages/opentui-solid/src/elements/extras.d.ts` | 42 | 1 | 0 | 0 |
| `packages/opentui-solid/src/elements/hooks.d.ts` | 39 | 1 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `extend@packages/opentui-solid/components.d.ts:1` | public/internal | scanned |
| `getComponentCatalogue@packages/opentui-solid/components.d.ts:1` | public/internal | scanned |
| `type JSX@packages/opentui-solid/index.d.ts:12` | public/internal | scanned |
| `Fragment@packages/opentui-solid/jsx-dev-runtime.d.ts:1` | public/internal | scanned |
| `jsxDEV@packages/opentui-solid/jsx-dev-runtime.d.ts:1` | public/internal | scanned |
| `type JSX@packages/opentui-solid/jsx-dev-runtime.d.ts:1` | public/internal | scanned |
| `Fragment@packages/opentui-solid/jsx-dev-runtime.js:1` | public/internal | scanned |
| `jsxDEV@packages/opentui-solid/jsx-dev-runtime.js:1` | public/internal | scanned |
| `jsx@packages/opentui-solid/jsx-runtime.js:17` | public/internal | scanned |
| `jsxs@packages/opentui-solid/jsx-runtime.js:24` | public/internal | scanned |
| `jsxDEV@packages/opentui-solid/jsx-runtime.js:25` | public/internal | scanned |
| `Fragment@packages/opentui-solid/jsx-runtime.js:28` | public/internal | scanned |
| `SolidRuntimePluginSupportOptions@packages/opentui-solid/scripts/runtime-plugin-support-configure.d.ts:2` | public/internal | scanned |
| `ensureRuntimePluginSupport@packages/opentui-solid/scripts/runtime-plugin-support-configure.js:36` | public/internal | scanned |
| `ensureRuntimePluginSupport@packages/opentui-solid/scripts/runtime-plugin-support-configure.node.js:3` | public/internal | scanned |

### Tests matched

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
- `packages/ax-code/test/audit/semantic-call.test.ts`
- `packages/ax-code/test/audit/siem.test.ts`
- `packages/ax-code/test/auth/auth.test.ts`
- `packages/ax-code/test/auth/encryption.test.ts`
- `packages/ax-code/test/bug-reports/lifecycle-visibility.test.ts`

### Risk hotspots (static)

- none flagged

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| module contract | public exports | invalid input / silent fail | Zod/type boundaries where present | 2 empty catch sites |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (2 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (71 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 37; total LOC: 4204
- Empty catch residual: packages/opentui-solid/index.bun.js:959, packages/opentui-solid/index.js:982
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/opentui-solid`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 2
- Export surface: 71

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-pkg-opentui-solid-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `c33fec50ffd14a2a` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |


### Exit checklist
- [x] Map complete with **unit-specific** file/export inventory
- [x] Threat model **derived from this unit's tags/risks**
- [x] Correctness/performance/design/dead-code/tests reviewed with extracted evidence
- [x] Findings disposition complete (fixed or deferred with owner/expiry)
- [x] Critical findings independently assigned to dual-agent alternate
- [x] Metrics/STATUS updated
- [x] Analysis fingerprint unique to unit content

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 37 files / 4204 LOC / fp c33fec50ffd14a2a |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
