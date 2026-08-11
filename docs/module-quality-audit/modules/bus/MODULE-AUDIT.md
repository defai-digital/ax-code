# MODULE-AUDIT: bus

| Field | Value |
|-------|-------|
| Unit slug | `bus` |
| Scope | `packages/ax-code/src/bus` |
| Resolved root | `packages/ax-code/src/bus` |
| XL filter | no |
| Wave / effort | Wave 2 / M |
| Risk tags | concurrency |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `6237620fac19294c` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 3 / 217 |
| Inventory ID | W2-13 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/bus/bus-event.ts` | 41 | 4 | 0 | 0 |
| `packages/ax-code/src/bus/global.ts` | 20 | 1 | 0 | 0 |
| `packages/ax-code/src/bus/index.ts` | 156 | 7 | 0 | 0 |

### Exports (sample)
- `BusEvent@packages/ax-code/src/bus/bus-event.ts:4`
- `Definition@packages/ax-code/src/bus/bus-event.ts:5`
- `define@packages/ax-code/src/bus/bus-event.ts:9`
- `payloads@packages/ax-code/src/bus/bus-event.ts:18`
- `GlobalBus@packages/ax-code/src/bus/global.ts:3`
- `Bus@packages/ax-code/src/bus/index.ts:9`
- `InstanceDisposed@packages/ax-code/src/bus/index.ts:15`
- `publish@packages/ax-code/src/bus/index.ts:86`
- `publishDetached@packages/ax-code/src/bus/index.ts:100`
- `subscribe@packages/ax-code/src/bus/index.ts:115`
- `once@packages/ax-code/src/bus/index.ts:122`
- `subscribeAll@packages/ax-code/src/bus/index.ts:135`

### Tests
- `packages/ax-code/test/bus/bus.test.ts`
- `packages/ax-code/test/bus/publish-callsite.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (12) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags concurrency | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `6237620fac19294c` |
| Dual-agent protocol | complete |
| Critical independent verify | codex-sol |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=9 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
