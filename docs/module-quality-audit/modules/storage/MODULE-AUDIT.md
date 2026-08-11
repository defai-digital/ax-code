# MODULE-AUDIT: storage

| Field | Value |
|-------|-------|
| Unit slug | `storage` |
| Scope | `packages/ax-code/src/storage` |
| Resolved root | `packages/ax-code/src/storage` |
| XL filter | no |
| Wave / effort | Wave 4 / L |
| Risk tags | persistence, stability |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | ax-code-glm |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `c7f796bc0e337309` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 8 / 1455 |
| Inventory ID | W4-01 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/storage/db.node.ts` | 17 | 1 | 0 | 0 |
| `packages/ax-code/src/storage/db.ts` | 332 | 11 | 0 | 0 |
| `packages/ax-code/src/storage/json-migration.ts` | 557 | 6 | 0 | 0 |
| `packages/ax-code/src/storage/migrate-journal.ts` | 34 | 1 | 0 | 0 |
| `packages/ax-code/src/storage/policy.ts` | 37 | 3 | 0 | 0 |
| `packages/ax-code/src/storage/schema.sql.ts` | 11 | 1 | 0 | 0 |
| `packages/ax-code/src/storage/schema.ts` | 22 | 0 | 0 | 0 |
| `packages/ax-code/src/storage/storage.ts` | 445 | 9 | 1 | 0 |

### Exports (sample)
- `init@packages/ax-code/src/storage/db.node.ts:6`
- `NotFoundError@packages/ax-code/src/storage/db.ts:26`
- `Database@packages/ax-code/src/storage/db.ts:35`
- `Path@packages/ax-code/src/storage/db.ts:36`
- `Transaction@packages/ax-code/src/storage/db.ts:48`
- `applyStartupPragmas@packages/ax-code/src/storage/db.ts:87`
- `Client@packages/ax-code/src/storage/db.ts:115`
- `close@packages/ax-code/src/storage/db.ts:152`
- `TxOrDb@packages/ax-code/src/storage/db.ts:192`
- `use@packages/ax-code/src/storage/db.ts:284`
- `effect@packages/ax-code/src/storage/db.ts:298`
- `transaction@packages/ax-code/src/storage/db.ts:314`
- `JsonMigration@packages/ax-code/src/storage/json-migration.ts:23`
- `Progress@packages/ax-code/src/storage/json-migration.ts:26`
- `OrphanStats@packages/ax-code/src/storage/json-migration.ts:36`
- `Stats@packages/ax-code/src/storage/json-migration.ts:45`
- `formatMigrationError@packages/ax-code/src/storage/json-migration.ts:76`
- `run@packages/ax-code/src/storage/json-migration.ts:80`
- `migrate@packages/ax-code/src/storage/migrate-journal.ts:23`
- `DurableStoragePolicy@packages/ax-code/src/storage/policy.ts:1`

### Tests
- `packages/ax-code/test/cli/doctor-storage.test.ts`
- `packages/ax-code/test/cli/storage-transfer.test.ts`
- `packages/ax-code/test/storage/db.test.ts`
- `packages/ax-code/test/storage/json-migration.test.ts`
- `packages/ax-code/test/storage/session-parent-fk.test.ts`
- `packages/ax-code/test/storage/storage.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (32) | static map |
| Silent failure | empty catch (1) | per-site disposition in findings |
| Secrets/process/IO | risk tags persistence,stability | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 8 source files; exports≈39
Step 2: Threat: secrets=1 files, processRisk=2 files, emptyCatch=1
Step 3: Correctness: read control flow for public surfaces; findings=AUDIT-storage-001.md, AUDIT-storage-empty-catch.md
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/storage
Step 6: Hygiene: empty=1; notes: packages/ax-code/src/storage/storage.ts: 1 empty catch(es) — see empty-catch finding disposition
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-storage-001 | stability | Critical | prior/new | verified-fixed |
| AUDIT-storage-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `c7f796bc0e337309` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=8 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
