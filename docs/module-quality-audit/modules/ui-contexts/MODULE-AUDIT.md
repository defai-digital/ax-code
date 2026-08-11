# MODULE-AUDIT: ui-contexts

| Field | Value |
|-------|-------|
| Unit slug | `ui-contexts` |
| Scope | `desktop/packages/ui/src/contexts` |
| Resolved root | `desktop/packages/ui/src/contexts` |
| XL filter | no |
| Wave / effort | Wave 8 / M |
| Risk tags | desktop |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `f1485f87c88ba6b2` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 7 / 1188 |
| Inventory ID | W8-04 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/contexts/DiffWorkerProvider.tsx` | 242 | 2 | 0 | 0 |
| `desktop/packages/ui/src/contexts/RuntimeAPIProvider.tsx` | 171 | 1 | 0 | 0 |
| `desktop/packages/ui/src/contexts/ThemeSystemContext.tsx` | 722 | 1 | 0 | 0 |
| `desktop/packages/ui/src/contexts/runtimeAPIContext.ts` | 5 | 1 | 0 | 0 |
| `desktop/packages/ui/src/contexts/runtimeAPIRegistry.ts` | 10 | 2 | 0 | 0 |
| `desktop/packages/ui/src/contexts/theme-system-context.ts` | 22 | 2 | 0 | 0 |
| `desktop/packages/ui/src/contexts/useThemeSystem.ts` | 16 | 2 | 0 | 0 |

### Exports (sample)
- `DiffWorkerProvider@desktop/packages/ui/src/contexts/DiffWorkerProvider.tsx:183`
- `useWorkerPool@desktop/packages/ui/src/contexts/DiffWorkerProvider.tsx:223`
- `RuntimeAPIProvider@desktop/packages/ui/src/contexts/RuntimeAPIProvider.tsx:161`
- `ThemeSystemProvider@desktop/packages/ui/src/contexts/ThemeSystemContext.tsx:203`
- `RuntimeAPIContext@desktop/packages/ui/src/contexts/runtimeAPIContext.ts:4`
- `registerRuntimeAPIs@desktop/packages/ui/src/contexts/runtimeAPIRegistry.ts:5`
- `getRegisteredRuntimeAPIs@desktop/packages/ui/src/contexts/runtimeAPIRegistry.ts:9`
- `ThemeContextValue@desktop/packages/ui/src/contexts/theme-system-context.ts:5`
- `ThemeSystemContext@desktop/packages/ui/src/contexts/theme-system-context.ts:21`
- `useThemeSystem@desktop/packages/ui/src/contexts/useThemeSystem.ts:5`
- `useOptionalThemeSystem@desktop/packages/ui/src/contexts/useThemeSystem.ts:13`

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (11) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `f1485f87c88ba6b2` |
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
