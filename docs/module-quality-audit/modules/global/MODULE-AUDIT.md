# MODULE-AUDIT: global

| Field | Value |
|-------|-------|
| Unit slug | `global` |
| Scope | `packages/ax-code/src/global` |
| Resolved root | `packages/ax-code/src/global` |
| XL filter | no |
| Wave / effort | Wave 4 / S |
| Risk tags | config |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `605e68731605c276` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 1 / 149 |
| Inventory ID | W4-06 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/global/index.ts` | 149 | 2 | 0 | 0 |

### Exports (sample)
- `Global@packages/ax-code/src/global/index.ts:37`
- `Path@packages/ax-code/src/global/index.ts:38`

### Tests
- `packages/ax-code/test/global/cache-cleanup.test.ts`
- `packages/ax-code/test/project/migrate-global.test.ts`
- `packages/ax-code/test/server/global-capabilities.test.ts`
- `packages/ax-code/test/server/global-config.test.ts`
- `packages/ax-code/test/server/global-session-list.test.ts`
- `packages/ax-code/test/support/test-globals.d.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (2) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags config | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `605e68731605c276` |
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
