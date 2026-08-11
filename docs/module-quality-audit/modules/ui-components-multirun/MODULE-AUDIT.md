# MODULE-AUDIT: ui-components-multirun

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-multirun` |
| Scope | `desktop/packages/ui/src/components/multirun` |
| Resolved root | `desktop/packages/ui/src/components/multirun` |
| XL filter | no |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `9446102202a88cb2` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 6 / 2122 |
| Inventory ID | W8-03-13 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/multirun/AgentSelector.tsx` | 99 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/multirun/BranchSelector.tsx` | 224 | 5 | 0 | 0 |
| `desktop/packages/ui/src/components/multirun/ModelMultiSelect.tsx` | 398 | 6 | 0 | 0 |
| `desktop/packages/ui/src/components/multirun/MultiRunFusionDialog.tsx` | 308 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/multirun/MultiRunLauncher.tsx` | 1075 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/multirun/index.ts` | 18 | 0 | 0 | 0 |

### Exports (sample)
- `MultirunAgentSelectorProps@desktop/packages/ui/src/components/multirun/AgentSelector.tsx:7`
- `AgentSelector@desktop/packages/ui/src/components/multirun/AgentSelector.tsx:26`
- `WorktreeBaseOption@desktop/packages/ui/src/components/multirun/BranchSelector.tsx:26`
- `MultirunBranchSelectorProps@desktop/packages/ui/src/components/multirun/BranchSelector.tsx:32`
- `BranchSelectorState@desktop/packages/ui/src/components/multirun/BranchSelector.tsx:47`
- `useBranchOptions@desktop/packages/ui/src/components/multirun/BranchSelector.tsx:59`
- `BranchSelector@desktop/packages/ui/src/components/multirun/BranchSelector.tsx:112`
- `ModelSelectionWithId@desktop/packages/ui/src/components/multirun/ModelMultiSelect.tsx:21`
- `ModelSelection@desktop/packages/ui/src/components/multirun/ModelMultiSelect.tsx:30`
- `generateInstanceId@desktop/packages/ui/src/components/multirun/ModelMultiSelect.tsx:38`
- `ModelChip@desktop/packages/ui/src/components/multirun/ModelMultiSelect.tsx:46`
- `ModelMultiSelectProps@desktop/packages/ui/src/components/multirun/ModelMultiSelect.tsx:71`
- `ModelMultiSelect@desktop/packages/ui/src/components/multirun/ModelMultiSelect.tsx:99`
- `MultiRunFusionDialog@desktop/packages/ui/src/components/multirun/MultiRunFusionDialog.tsx:75`
- `MultiRunLauncher@desktop/packages/ui/src/components/multirun/MultiRunLauncher.tsx:90`

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (15) | static map |
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
| Static extract | ok fp `9446102202a88cb2` |
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
