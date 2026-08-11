# MODULE-AUDIT: wiki

| Field | Value |
|-------|-------|
| Unit slug | `wiki` |
| Scope | `packages/ax-code/src/wiki` |
| Resolved root | `packages/ax-code/src/wiki` |
| XL filter | no |
| Wave / effort | Wave 5 / M |
| Risk tags | quality |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `eb24d2e2edb1209f` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 3 / 250 |
| Inventory ID | W5-19 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/wiki/config.ts` | 61 | 3 | 0 | 0 |
| `packages/ax-code/src/wiki/index.ts` | 4 | 0 | 0 | 0 |
| `packages/ax-code/src/wiki/native.ts` | 185 | 3 | 0 | 0 |

### Exports (sample)
- `WikiRuntimeConfig@packages/ax-code/src/wiki/config.ts:5`
- `resolveWikiRuntimeConfig@packages/ax-code/src/wiki/config.ts:35`
- `engineConfig@packages/ax-code/src/wiki/config.ts:49`
- `gitHeadCommit@packages/ax-code/src/wiki/native.ts:100`
- `planNativeWiki@packages/ax-code/src/wiki/native.ts:133`
- `runNativeWiki@packages/ax-code/src/wiki/native.ts:144`

### Tests
- none auto-matched

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
| Static extract | ok fp `eb24d2e2edb1209f` |
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
