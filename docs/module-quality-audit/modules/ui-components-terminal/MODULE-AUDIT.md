# MODULE-AUDIT: ui-components-terminal

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-terminal` |
| Scope | `desktop/packages/ui/src/components/terminal` |
| Resolved root | `desktop/packages/ui/src/components/terminal` |
| XL filter | no |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `cfeb22d6bedca5e7` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 1735 |
| Inventory ID | W8-03-20 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/terminal/TerminalViewport.tsx` | 1735 | 0 | 0 | 0 |

### Exports (sample)
- none

### Tests
- `packages/ax-code/test/cli/tui/terminal-cleanup.test.ts`
- `packages/ax-code/test/cli/tui/terminal-suspend.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (0) | static map |
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
| Static extract | ok fp `cfeb22d6bedca5e7` |
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
