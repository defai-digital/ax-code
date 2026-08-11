# MODULE-AUDIT: crate-terminal

| Field | Value |
|-------|-------|
| Unit slug | `crate-terminal` |
| Scope | `crates/ax-code-terminal` |
| Resolved root | `crates/ax-code-terminal` |
| XL filter | no |
| Wave / effort | Wave 9 / L |
| Risk tags | native, stability |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `83a62bb627268d97` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 2 / 944 |
| Inventory ID | W9-19 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `crates/ax-code-terminal/build.rs` | 6 | 0 | 0 | 0 |
| `crates/ax-code-terminal/src/lib.rs` | 938 | 0 | 0 | 0 |

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
| Secrets/process/IO | risk tags native,stability | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-crate-terminal-001 | stability | Critical | prior/new | verified-fixed |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `83a62bb627268d97` |
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
