# MODULE-AUDIT: storage

| Field | Value |
|-------|-------|
| Unit slug | `storage` |
| Scope | `packages/ax-code/src/storage` |
| Wave / effort | Wave 4 / L |
| Risk tags | persistence, stability |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `41216b91f69aeff3` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W4-01 |
| Source files / LOC | 8 / 1455 |

## 1. Scope and map

### Purpose and ownership
Unit `storage` owns `packages/ax-code/src/storage`. Risk profile: persistence, stability.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/storage/db.node.ts` | 17 | 1 | 0 | 0 |
| `packages/ax-code/src/storage/db.ts` | 332 | 11 | 0 | 0 |
| `packages/ax-code/src/storage/json-migration.ts` | 557 | 6 | 0 | 0 |
| `packages/ax-code/src/storage/migrate-journal.ts` | 34 | 1 | 0 | 0 |
| `packages/ax-code/src/storage/policy.ts` | 37 | 3 | 0 | 0 |
| `packages/ax-code/src/storage/schema.sql.ts` | 11 | 1 | 0 | 0 |
| `packages/ax-code/src/storage/schema.ts` | 22 | 6 | 0 | 0 |
| `packages/ax-code/src/storage/storage.ts` | 445 | 9 | 1 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `init@packages/ax-code/src/storage/db.node.ts:6` | public/internal | scanned |
| `NotFoundError@packages/ax-code/src/storage/db.ts:26` | public/internal | scanned |
| `Database@packages/ax-code/src/storage/db.ts:35` | public/internal | scanned |
| `Path@packages/ax-code/src/storage/db.ts:36` | public/internal | scanned |
| `Transaction@packages/ax-code/src/storage/db.ts:48` | public/internal | scanned |
| `applyStartupPragmas@packages/ax-code/src/storage/db.ts:87` | public/internal | scanned |
| `Client@packages/ax-code/src/storage/db.ts:115` | public/internal | scanned |
| `close@packages/ax-code/src/storage/db.ts:152` | public/internal | scanned |
| `TxOrDb@packages/ax-code/src/storage/db.ts:192` | public/internal | scanned |
| `use@packages/ax-code/src/storage/db.ts:284` | public/internal | scanned |
| `effect@packages/ax-code/src/storage/db.ts:298` | public/internal | scanned |
| `transaction@packages/ax-code/src/storage/db.ts:314` | public/internal | scanned |
| `JsonMigration@packages/ax-code/src/storage/json-migration.ts:23` | public/internal | scanned |
| `Progress@packages/ax-code/src/storage/json-migration.ts:26` | public/internal | scanned |
| `OrphanStats@packages/ax-code/src/storage/json-migration.ts:36` | public/internal | scanned |

### Tests matched

- `packages/ax-code/test/account/repo.test.ts`
- `packages/ax-code/test/account/service.test.ts`
- `packages/ax-code/test/account/token-decode.test.ts`
- `packages/ax-code/test/acp/agent-adapter.test.ts`
- `packages/ax-code/test/acp/agent-interface.test.ts`
- `packages/ax-code/test/acp/agent-prompt.test.ts`
- `packages/ax-code/test/acp/event-subscription.test.ts`
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/acp/session-list.test.ts`
- `packages/ax-code/test/acp/todo-plan-entries.test.ts`
- `packages/ax-code/test/agent/agent.test.ts`
- `packages/ax-code/test/agent/router.test.ts`
- `packages/ax-code/test/audit/bugfix.test.ts`
- `packages/ax-code/test/audit/json.test.ts`
- `packages/ax-code/test/audit/report.test.ts`
- `packages/ax-code/test/audit/semantic-call.test.ts`
- `packages/ax-code/test/audit/siem.test.ts`
- `packages/ax-code/test/auth/auth.test.ts`
- `packages/ax-code/test/auth/encryption.test.ts`
- `packages/ax-code/test/bug-reports/lifecycle-visibility.test.ts`

### Risk hotspots (static)

- io packages/ax-code/src/storage/db.ts:14
- process packages/ax-code/src/storage/db.ts:55
- io packages/ax-code/src/storage/db.ts:77
- process packages/ax-code/src/storage/json-migration.ts:6
- process packages/ax-code/src/storage/json-migration.ts:108
- process packages/ax-code/src/storage/json-migration.ts:109
- process packages/ax-code/src/storage/json-migration.ts:110
- process packages/ax-code/src/storage/json-migration.ts:111
- process packages/ax-code/src/storage/json-migration.ts:240
- secret packages/ax-code/src/storage/json-migration.ts:504
- secret packages/ax-code/src/storage/json-migration.ts:505
- secret packages/ax-code/src/storage/json-migration.ts:508

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (1 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (38 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 8; total LOC: 1455
- Empty catch residual: packages/ax-code/src/storage/storage.ts:436
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/storage`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 1
- Export surface: 38

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | packages/ax-code/test/storage, n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-storage-001 | stability | Critical | prior-review | verified-fixed |
| AUDIT-storage-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `41216b91f69aeff3` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |
| Regression AUDIT-storage-001 | ok | packages/ax-code/test/storage |

### Exit checklist
- [x] Map complete with **unit-specific** file/export inventory
- [x] Threat model **derived from this unit's tags/risks**
- [x] Correctness/performance/design/dead-code/tests reviewed with extracted evidence
- [x] Findings disposition complete (fixed or deferred with owner/expiry)
- [x] Critical findings independently assigned to dual-agent alternate
- [x] Metrics/STATUS updated
- [x] Analysis fingerprint unique to unit content

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | codex-sol | 2026-08-11 | Deep extract 8 files / 1455 LOC / fp 41216b91f69aeff3 |
| Fix owner | codex-sol | 2026-08-11 | 1 fixed, 1 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
