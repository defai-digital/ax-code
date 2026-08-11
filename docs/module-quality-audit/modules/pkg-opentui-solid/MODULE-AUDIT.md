# MODULE-AUDIT: pkg-opentui-solid

| Field | Value |
|-------|-------|
| Unit slug | `pkg-opentui-solid` |
| Scope | `packages/opentui-solid` |
| Resolved root | `packages/opentui-solid` |
| XL filter | no |
| Wave / effort | Wave 9 / L |
| Risk tags | ui |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `87ecd4d946a42062` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 37 / 4204 |
| Inventory ID | W9-06 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/opentui-solid/components.d.ts` | 3 | 0 | 0 | 0 |
| `packages/opentui-solid/components.js` | 112 | 0 | 0 | 0 |
| `packages/opentui-solid/index.bun.js` | 1610 | 0 | 1 | 0 |
| `packages/opentui-solid/index.d.ts` | 13 | 0 | 0 | 0 |
| `packages/opentui-solid/index.js` | 1630 | 0 | 1 | 0 |
| `packages/opentui-solid/jsx-dev-runtime.d.ts` | 2 | 0 | 0 | 0 |
| `packages/opentui-solid/jsx-dev-runtime.js` | 2 | 0 | 0 | 0 |
| `packages/opentui-solid/jsx-runtime.d.ts` | 55 | 0 | 0 | 0 |
| `packages/opentui-solid/jsx-runtime.js` | 31 | 4 | 0 | 0 |
| `packages/opentui-solid/scripts/preload.js` | 3 | 0 | 0 | 0 |
| `packages/opentui-solid/scripts/preload.node.js` | 2 | 0 | 0 | 0 |
| `packages/opentui-solid/scripts/runtime-plugin-support-configure.d.ts` | 8 | 1 | 0 | 0 |
| `packages/opentui-solid/scripts/runtime-plugin-support-configure.js` | 67 | 1 | 0 | 0 |
| `packages/opentui-solid/scripts/runtime-plugin-support-configure.node.js` | 19 | 2 | 0 | 0 |
| `packages/opentui-solid/scripts/runtime-plugin-support.d.ts` | 4 | 0 | 0 | 0 |
| `packages/opentui-solid/scripts/runtime-plugin-support.js` | 4 | 0 | 0 | 0 |
| `packages/opentui-solid/scripts/runtime-plugin-support.node.js` | 19 | 2 | 0 | 0 |
| `packages/opentui-solid/scripts/solid-plugin.d.ts` | 12 | 1 | 0 | 0 |
| `packages/opentui-solid/scripts/solid-plugin.js` | 76 | 3 | 0 | 0 |
| `packages/opentui-solid/scripts/solid-plugin.node.js` | 37 | 6 | 0 | 0 |
| `packages/opentui-solid/scripts/solid-transform.d.ts` | 11 | 2 | 0 | 0 |
| `packages/opentui-solid/scripts/solid-transform.js` | 66 | 4 | 0 | 0 |
| `packages/opentui-solid/src/elements/catalogue.d.ts` | 70 | 2 | 0 | 0 |
| `packages/opentui-solid/src/elements/extras.d.ts` | 42 | 1 | 0 | 0 |
| `packages/opentui-solid/src/elements/hooks.d.ts` | 39 | 1 | 0 | 0 |
| `packages/opentui-solid/src/elements/index.d.ts` | 5 | 0 | 0 | 0 |
| `packages/opentui-solid/src/elements/slot.d.ts` | 63 | 0 | 0 | 0 |
| `packages/opentui-solid/src/plugins/slot.d.ts` | 26 | 6 | 0 | 0 |
| `packages/opentui-solid/src/reconciler.d.ts` | 6 | 1 | 0 | 0 |
| `packages/opentui-solid/src/renderer/index.d.ts` | 4 | 0 | 0 | 0 |

### Exports (sample)
- `jsx@packages/opentui-solid/jsx-runtime.js:17`
- `jsxs@packages/opentui-solid/jsx-runtime.js:24`
- `jsxDEV@packages/opentui-solid/jsx-runtime.js:25`
- `Fragment@packages/opentui-solid/jsx-runtime.js:28`
- `SolidRuntimePluginSupportOptions@packages/opentui-solid/scripts/runtime-plugin-support-configure.d.ts:2`
- `ensureRuntimePluginSupport@packages/opentui-solid/scripts/runtime-plugin-support-configure.js:36`
- `ensureRuntimePluginSupport@packages/opentui-solid/scripts/runtime-plugin-support-configure.node.js:3`
- `ensureRuntimePluginSupport@packages/opentui-solid/scripts/runtime-plugin-support-configure.node.js:14`
- `ensureRuntimePluginSupport@packages/opentui-solid/scripts/runtime-plugin-support.node.js:3`
- `ensureRuntimePluginSupport@packages/opentui-solid/scripts/runtime-plugin-support.node.js:14`
- `CreateSolidTransformPluginOptions@packages/opentui-solid/scripts/solid-plugin.d.ts:3`
- `ensureSolidTransformPlugin@packages/opentui-solid/scripts/solid-plugin.js:15`
- `resetSolidTransformPluginState@packages/opentui-solid/scripts/solid-plugin.js:30`
- `createSolidTransformPlugin@packages/opentui-solid/scripts/solid-plugin.js:35`
- `ensureSolidTransformPlugin@packages/opentui-solid/scripts/solid-plugin.node.js:3`
- `resetSolidTransformPluginState@packages/opentui-solid/scripts/solid-plugin.node.js:7`
- `createSolidTransformPlugin@packages/opentui-solid/scripts/solid-plugin.node.js:11`
- `ensureSolidTransformPlugin@packages/opentui-solid/scripts/solid-plugin.node.js:22`
- `resetSolidTransformPluginState@packages/opentui-solid/scripts/solid-plugin.node.js:26`
- `createSolidTransformPlugin@packages/opentui-solid/scripts/solid-plugin.node.js:30`

### Tests
- `packages/ax-code/test/cli/tui/opentui-ffi-coordinate-guard.test.ts`
- `packages/ax-code/test/cli/tui/opentui-ffi-pointer-pin.test.ts`
- `packages/ax-code/test/cli/tui/opentui-spinner.test.ts`
- `packages/ax-code/test/script/check-no-effect-solid-in-v4.test.ts`
- `packages/ax-code/test/script/esbuild-solid-plugin.test.ts`
- `packages/ax-code/test/script/opentui-package-integrity.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (60) | static map |
| Silent failure | empty catch (2) | per-site disposition in findings |
| Secrets/process/IO | risk tags ui | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-pkg-opentui-solid-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `87ecd4d946a42062` |
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
