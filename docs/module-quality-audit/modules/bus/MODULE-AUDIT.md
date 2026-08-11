# MODULE-AUDIT: bus

| Field | Value |
|-------|-------|
| Unit slug | `bus` |
| Scope | `packages/ax-code/src/bus` |
| Resolved root | `packages/ax-code/src/bus` |
| XL filter | no |
| Wave / effort | Wave 2 / M |
| Risk tags | concurrency |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `6237620fac19294c` |
| Protocol marker | pending dual-agent 9-step |
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

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `6237620fac19294c` |
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
