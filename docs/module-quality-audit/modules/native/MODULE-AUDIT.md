# MODULE-AUDIT: native

| Field | Value |
|-------|-------|
| Unit slug | `native` |
| Scope | `packages/ax-code/src/native` |
| Resolved root | `packages/ax-code/src/native` |
| XL filter | no |
| Wave / effort | Wave 3 / M |
| Risk tags | native, stability |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `9545076be4e6cbef` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 88 |
| Inventory ID | W3-12 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/native/addon.ts` | 88 | 6 | 0 | 0 |

### Exports (sample)
- `formatNativeAddonLoadError@packages/ax-code/src/native/addon.ts:43`
- `NativeAddon@packages/ax-code/src/native/addon.ts:67`
- `fs@packages/ax-code/src/native/addon.ts:69`
- `diff@packages/ax-code/src/native/addon.ts:74`
- `index@packages/ax-code/src/native/addon.ts:79`
- `parser@packages/ax-code/src/native/addon.ts:84`

### Tests
- `packages/ax-code/test/code-intelligence/native-store.test.ts`
- `packages/ax-code/test/code-intelligence/query-native-dispatch.test.ts`
- `packages/ax-code/test/debug-engine/native-scan.test.ts`
- `packages/ax-code/test/native/addon.test.ts`
- `packages/ax-code/test/perf/native.test.ts`
- `packages/ax-code/test/util/native-json.test.ts`
- `packages/ax-code/test/visual/native.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (6) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags native,stability | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `9545076be4e6cbef` |
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
