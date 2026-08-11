# MODULE-AUDIT: telemetry

| Field | Value |
|-------|-------|
| Unit slug | `telemetry` |
| Scope | `packages/ax-code/src/telemetry` |
| Resolved root | `packages/ax-code/src/telemetry` |
| XL filter | no |
| Wave / effort | Wave 4 / M |
| Risk tags | quality |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `2f5b66a38bf7801b` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 2 / 272 |
| Inventory ID | W4-09 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/telemetry/index.ts` | 178 | 6 | 0 | 0 |
| `packages/ax-code/src/telemetry/span.ts` | 94 | 2 | 1 | 0 |

### Exports (sample)
- `Telemetry@packages/ax-code/src/telemetry/index.ts:18`
- `endpoint@packages/ax-code/src/telemetry/index.ts:24`
- `enabled@packages/ax-code/src/telemetry/index.ts:28`
- `init@packages/ax-code/src/telemetry/index.ts:32`
- `exportSession@packages/ax-code/src/telemetry/index.ts:72`
- `shutdown@packages/ax-code/src/telemetry/index.ts:161`
- `withSpan@packages/ax-code/src/telemetry/span.ts:38`
- `withSpanSync@packages/ax-code/src/telemetry/span.ts:69`

### Tests
- `packages/ax-code/test/telemetry/index.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (8) | static map |
| Silent failure | empty catch (1) | per-site disposition in findings |
| Secrets/process/IO | risk tags quality | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-telemetry-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `2f5b66a38bf7801b` |
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
