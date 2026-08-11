# MODULE-AUDIT: capability

| Field | Value |
|-------|-------|
| Unit slug | `capability` |
| Scope | `packages/ax-code/src/capability` |
| Resolved root | `packages/ax-code/src/capability` |
| XL filter | no |
| Wave / effort | Wave 5 / M |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `cab6c0089e3b7b3410f050bc9d824c06a3c3a814` |
| Analysis fingerprint | `70482ae5011ed636` |
| Protocol marker | agent-protocol.json complete |
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

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `70482ae5011ed636` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=7 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
