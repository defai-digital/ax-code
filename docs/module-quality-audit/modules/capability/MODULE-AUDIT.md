# MODULE-AUDIT: capability

| Field | Value |
|-------|-------|
| Unit slug | `capability` |
| Scope | `packages/ax-code/src/capability` |
| Resolved root | `packages/ax-code/src/capability` |
| XL filter | no |
| Wave / effort | Wave 5 / M |
| Risk tags | quality |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `70482ae5011ed636` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 227 |
| Inventory ID | W5-09 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/capability/index.ts` | 227 | 6 | 0 | 0 |

### Exports (sample)
- `Capability@packages/ax-code/src/capability/index.ts:12`
- `Warning@packages/ax-code/src/capability/index.ts:13`
- `Warning@packages/ax-code/src/capability/index.ts:18`
- `Info@packages/ax-code/src/capability/index.ts:20`
- `Info@packages/ax-code/src/capability/index.ts:31`
- `list@packages/ax-code/src/capability/index.ts:33`

### Tests
- `packages/ax-code/test/capability/capability.test.ts`
- `packages/ax-code/test/cli/capability.test.ts`
- `packages/ax-code/test/cli/tui/capability-catalog.test.ts`
- `packages/ax-code/test/server/capability.test.ts`
- `packages/ax-code/test/visual/capability.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (6) | static map |
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
| Static extract | ok fp `70482ae5011ed636` |
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
