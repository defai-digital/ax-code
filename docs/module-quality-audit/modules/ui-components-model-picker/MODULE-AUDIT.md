# MODULE-AUDIT: ui-components-model-picker

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-model-picker` |
| Scope | `desktop/packages/ui/src/components/model-picker` |
| Resolved root | `desktop/packages/ui/src/components/model-picker` |
| XL filter | no |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `ed53663e759dee8c` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 862 |
| Inventory ID | W8-03-12 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/model-picker/ModelPickerList.tsx` | 862 | 5 | 0 | 0 |

### Exports (sample)
- `ModelPickerModel@desktop/packages/ui/src/components/model-picker/ModelPickerList.tsx:17`
- `ModelPickerProvider@desktop/packages/ui/src/components/model-picker/ModelPickerList.tsx:19`
- `ModelPickerEntry@desktop/packages/ui/src/components/model-picker/ModelPickerList.tsx:25`
- `ModelPickerFavoriteEntry@desktop/packages/ui/src/components/model-picker/ModelPickerList.tsx:31`
- `ModelPickerList@desktop/packages/ui/src/components/model-picker/ModelPickerList.tsx:339`

### Tests
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/plugin-auth-picker.test.ts`
- `packages/ax-code/test/cli/prompt-view-model.test.ts`
- `packages/ax-code/test/cli/tui/dialog-help-view-model.test.ts`
- `packages/ax-code/test/cli/tui/dialog-model-options.test.ts`
- `packages/ax-code/test/cli/tui/dialog-select-view-model.test.ts`
- `packages/ax-code/test/cli/tui/directory-view-model.test.ts`
- `packages/ax-code/test/cli/tui/footer-view-model.test.ts`
- `packages/ax-code/test/cli/tui/model-display-info.test.ts`
- `packages/ax-code/test/cli/tui/prompt-liveness-view-model.test.ts`
- `packages/ax-code/test/cli/tui/prompt-paste-view-model.test.ts`
- `packages/ax-code/test/cli/tui/prompt-view-model.test.ts`
- `packages/ax-code/test/cli/tui/run-mode-view-model.test.ts`
- `packages/ax-code/test/cli/tui/session-header-view-model.test.ts`
- `packages/ax-code/test/cli/tui/session-picker-view-model.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (5) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop,ui | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `ed53663e759dee8c` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=10 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
