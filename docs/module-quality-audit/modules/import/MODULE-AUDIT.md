# MODULE-AUDIT: import

| Field | Value |
|-------|-------|
| Unit slug | `import` |
| Scope | `packages/ax-code/src/import` |
| Resolved root | `packages/ax-code/src/import` |
| XL filter | no |
| Wave / effort | Wave 3 / M |
| Risk tags | correctness |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `cab6c0089e3b7b3410f050bc9d824c06a3c3a814` |
| Analysis fingerprint | `21e366940c20309e` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 163 |
| Inventory ID | W3-14 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/import/compatibility.ts` | 163 | 9 | 0 | 0 |

### Exports (sample)
- `CompatibilityImport@packages/ax-code/src/import/compatibility.ts:7`
- `Source@packages/ax-code/src/import/compatibility.ts:8`
- `Source@packages/ax-code/src/import/compatibility.ts:9`
- `Candidate@packages/ax-code/src/import/compatibility.ts:11`
- `Candidate@packages/ax-code/src/import/compatibility.ts:20`
- `Report@packages/ax-code/src/import/compatibility.ts:22`
- `Report@packages/ax-code/src/import/compatibility.ts:30`
- `plan@packages/ax-code/src/import/compatibility.ts:38`
- `run@packages/ax-code/src/import/compatibility.ts:59`

### Tests
- `packages/ax-code/test/cli/import.test.ts`
- `packages/ax-code/test/code-intelligence/import-edges.test.ts`
- `packages/ax-code/test/import-compatibility.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (9) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags correctness | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `21e366940c20309e` |
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
