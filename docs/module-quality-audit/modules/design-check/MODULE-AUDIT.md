# MODULE-AUDIT: design-check

| Field | Value |
|-------|-------|
| Unit slug | `design-check` |
| Scope | `packages/ax-code/src/design-check` |
| Resolved root | `packages/ax-code/src/design-check` |
| XL filter | no |
| Wave / effort | Wave 5 / M |
| Risk tags | quality |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `d8fd92989ec7c1a0` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 8 / 470 |
| Inventory ID | W5-15 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/design-check/index.ts` | 143 | 2 | 0 | 0 |
| `packages/ax-code/src/design-check/rules/alt-text.ts` | 43 | 1 | 0 | 0 |
| `packages/ax-code/src/design-check/rules/colors.ts` | 71 | 1 | 0 | 0 |
| `packages/ax-code/src/design-check/rules/form-labels.ts` | 50 | 1 | 0 | 0 |
| `packages/ax-code/src/design-check/rules/index.ts` | 13 | 1 | 0 | 0 |
| `packages/ax-code/src/design-check/rules/inline-styles.ts` | 53 | 1 | 0 | 0 |
| `packages/ax-code/src/design-check/rules/spacing.ts` | 42 | 1 | 0 | 0 |
| `packages/ax-code/src/design-check/types.ts` | 55 | 7 | 0 | 0 |

### Exports (sample)
- `runDesignCheck@packages/ax-code/src/design-check/index.ts:56`
- `formatResult@packages/ax-code/src/design-check/index.ts:116`
- `missingAltText@packages/ax-code/src/design-check/rules/alt-text.ts:10`
- `noHardcodedColors@packages/ax-code/src/design-check/rules/colors.ts:12`
- `missingFormLabels@packages/ax-code/src/design-check/rules/form-labels.ts:10`
- `ALL_RULES@packages/ax-code/src/design-check/rules/index.ts:12`
- `noInlineStyles@packages/ax-code/src/design-check/rules/inline-styles.ts:11`
- `noRawSpacing@packages/ax-code/src/design-check/rules/spacing.ts:11`
- `Severity@packages/ax-code/src/design-check/types.ts:5`
- `RuleConfig@packages/ax-code/src/design-check/types.ts:7`
- `DesignCheckConfig@packages/ax-code/src/design-check/types.ts:15`
- `Violation@packages/ax-code/src/design-check/types.ts:25`
- `FileResult@packages/ax-code/src/design-check/types.ts:35`
- `CheckResult@packages/ax-code/src/design-check/types.ts:40`
- `Rule@packages/ax-code/src/design-check/types.ts:49`

### Tests
- `packages/ax-code/test/cli/release-check.test.ts`
- `packages/ax-code/test/cli/tui/upgrade-check-view-model.test.ts`
- `packages/ax-code/test/planner/check-policy.test.ts`
- `packages/ax-code/test/script/check-bare-json-parse.test.ts`
- `packages/ax-code/test/script/check-no-effect-solid-in-v4.test.ts`
- `packages/ax-code/test/script/check-tui-layering.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (15) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags quality | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `d8fd92989ec7c1a0` |
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
