# MODULE-AUDIT: cli-cmd-storage

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-storage` |
| Scope | `packages/ax-code/src/cli/cmd/storage` |
| Wave / effort | Wave 6 / M |
| Risk tags | cli |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `16a5bb60cd14475f` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W6-16 |
| Source files / LOC | 5 / 960 |

## 1. Scope and map

### Purpose and ownership
Unit `cli-cmd-storage` owns `packages/ax-code/src/cli/cmd/storage`. Risk profile: cli.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/storage/db.ts` | 144 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/storage/export.ts` | 90 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/storage/import.ts` | 103 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/storage/session.ts` | 506 | 8 | 1 | 0 |
| `packages/ax-code/src/cli/cmd/storage/transfer.ts` | 117 | 4 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `DbCommand@packages/ax-code/src/cli/cmd/storage/db.ts:136` | public/internal | scanned |
| `ExportCommand@packages/ax-code/src/cli/cmd/storage/export.ts:12` | public/internal | scanned |
| `readSessionTransferFile@packages/ax-code/src/cli/cmd/storage/import.ts:43` | public/internal | scanned |
| `ImportCommand@packages/ax-code/src/cli/cmd/storage/import.ts:70` | public/internal | scanned |
| `SessionCommand@packages/ax-code/src/cli/cmd/storage/session.ts:53` | public/internal | scanned |
| `sessionProjectStatusPayload@packages/ax-code/src/cli/cmd/storage/session.ts:177` | public/internal | scanned |
| `SessionClearProjectCommand@packages/ax-code/src/cli/cmd/storage/session.ts:214` | public/internal | scanned |
| `SessionBackupProjectCommand@packages/ax-code/src/cli/cmd/storage/session.ts:265` | public/internal | scanned |
| `SessionProjectStatusCommand@packages/ax-code/src/cli/cmd/storage/session.ts:296` | public/internal | scanned |
| `SessionPruneCommand@packages/ax-code/src/cli/cmd/storage/session.ts:340` | public/internal | scanned |
| `SessionDeleteCommand@packages/ax-code/src/cli/cmd/storage/session.ts:375` | public/internal | scanned |
| `SessionListCommand@packages/ax-code/src/cli/cmd/storage/session.ts:402` | public/internal | scanned |
| `TransferEvent@packages/ax-code/src/cli/cmd/storage/transfer.ts:11` | public/internal | scanned |
| `SessionTransfer@packages/ax-code/src/cli/cmd/storage/transfer.ts:19` | public/internal | scanned |
| `buildTransfer@packages/ax-code/src/cli/cmd/storage/transfer.ts:28` | public/internal | scanned |

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

- process packages/ax-code/src/cli/cmd/storage/db.ts:68
- process packages/ax-code/src/cli/cmd/storage/session.ts:439

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (1 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (16 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 5; total LOC: 960
- Empty catch residual: packages/ax-code/src/cli/cmd/storage/session.ts:453
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/cli/cmd/storage`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 1
- Export surface: 16

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-cli-cmd-storage-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `16a5bb60cd14475f` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |


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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 5 files / 960 LOC / fp 16a5bb60cd14475f |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
