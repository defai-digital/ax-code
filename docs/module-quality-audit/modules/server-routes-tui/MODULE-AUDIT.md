# MODULE-AUDIT: server-routes-tui

| Field | Value |
|-------|-------|
| Unit slug | `server-routes-tui` |
| Scope | `packages/ax-code/src/server/routes/tui.ts` |
| Resolved root | `packages/ax-code/src/server/routes/tui.ts` |
| XL filter | no |
| Wave / effort | Wave 4 / S |
| Risk tags | network, api |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `f1a8dc6ddb2b5edc` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 303 |
| Inventory ID | W4-03-35 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/server/routes/tui.ts` | 303 | 1 | 0 | 0 |

### Exports (sample)
- `TuiRoutes@packages/ax-code/src/server/routes/tui.ts:34`

### Tests
- `packages/ax-code/test/cli/cmd/tui/component/slash-frecency.test.ts`
- `packages/ax-code/test/cli/cmd/tui/prompt-part.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/cmd/tui/ui/glyphs.test.ts`
- `packages/ax-code/test/cli/tui/abortable-resource.test.ts`
- `packages/ax-code/test/cli/tui/agent-control-activity.test.ts`
- `packages/ax-code/test/cli/tui/autocomplete-group-headers.test.ts`
- `packages/ax-code/test/cli/tui/autocomplete-line-range.test.ts`
- `packages/ax-code/test/cli/tui/autocomplete-scroll.test.ts`
- `packages/ax-code/test/cli/tui/background-task.test.ts`
- `packages/ax-code/test/cli/tui/c-dialog-provider-auth-errors.test.ts`
- `packages/ax-code/test/cli/tui/capability-catalog.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (1) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags network,api | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `f1a8dc6ddb2b5edc` |
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
