# MODULE-AUDIT: telemetry

| Field | Value |
|-------|-------|
| Unit slug | `telemetry` |
| Scope | `packages/ax-code/src/telemetry` |
| Resolved root | `packages/ax-code/src/telemetry` |
| XL filter | no |
| Wave / effort | Wave 4 / M |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `cab6c0089e3b7b3410f050bc9d824c06a3c3a814` |
| Analysis fingerprint | `2f5b66a38bf7801b` |
| Protocol marker | agent-protocol.json complete |
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

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-telemetry-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `2f5b66a38bf7801b` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=11 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
