# MODULE-AUDIT: ui-components-update

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-update` |
| Scope | `desktop/packages/ui/src/components/update` |
| Resolved root | `desktop/packages/ui/src/components/update` |
| XL filter | no |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `9b7ac27cc548f0ea` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 3 / 529 |
| Inventory ID | W8-03-22 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/update/AxCodeUpdateToast.tsx` | 211 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/update/__tests__/axCodeUpdateDedup.test.ts` | 226 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts` | 92 | 7 | 0 | 0 |

### Exports (sample)
- `AxCodeUpdateToast@desktop/packages/ui/src/components/update/AxCodeUpdateToast.tsx:24`
- `AxCodeUpdateToastDecisionInput@desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts:13`
- `shouldShowAxCodeUpdateToast@desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts:30`
- `resolveAxCodeUpdateVersion@desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts:45`
- `AxCodeUpgradeStatusLike@desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts:52`
- `resolveAxCodeUpgradeStatusVersion@desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts:65`
- `AxCodeIncompatibility@desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts:72`
- `resolveAxCodeIncompatibility@desktop/packages/ui/src/components/update/axCodeUpdateDedup.ts:82`

### Tests
- `packages/ax-code/test/script/update-models.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (8) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop,ui | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `9b7ac27cc548f0ea` |
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
