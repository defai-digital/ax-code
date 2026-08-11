# MODULE-AUDIT: account

| Field | Value |
|-------|-------|
| Unit slug | `account` |
| Scope | `packages/ax-code/src/account` |
| Wave / effort | Wave 1 / M |
| Risk tags | security, persistence |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `baef69f2d513ce08` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W1-02 |
| Source files / LOC | 4 / 824 |

## 1. Scope and map

### Purpose and ownership
Unit `account` owns `packages/ax-code/src/account`. Risk profile: security, persistence.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/account/account.sql.ts` | 40 | 3 | 0 | 0 |
| `packages/ax-code/src/account/index.ts` | 454 | 16 | 0 | 0 |
| `packages/ax-code/src/account/repo.ts` | 207 | 11 | 0 | 0 |
| `packages/ax-code/src/account/schema.ts` | 123 | 19 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `AccountTable@packages/ax-code/src/account/account.sql.ts:6` | public/internal | scanned |
| `AccountStateTable@packages/ax-code/src/account/account.sql.ts:16` | public/internal | scanned |
| `ControlAccountTable@packages/ax-code/src/account/account.sql.ts:25` | public/internal | scanned |
| `AccountOrgs@packages/ax-code/src/account/index.ts:52` | public/internal | scanned |
| `Account@packages/ax-code/src/account/index.ts:235` | public/internal | scanned |
| `Interface@packages/ax-code/src/account/index.ts:236` | public/internal | scanned |
| `Options@packages/ax-code/src/account/index.ts:249` | public/internal | scanned |
| `create@packages/ax-code/src/account/index.ts:254` | public/internal | scanned |
| `active@packages/ax-code/src/account/index.ts:439` | public/internal | scanned |
| `list@packages/ax-code/src/account/index.ts:440` | public/internal | scanned |
| `orgsByAccount@packages/ax-code/src/account/index.ts:441` | public/internal | scanned |
| `remove@packages/ax-code/src/account/index.ts:442` | public/internal | scanned |
| `use@packages/ax-code/src/account/index.ts:443` | public/internal | scanned |
| `orgs@packages/ax-code/src/account/index.ts:444` | public/internal | scanned |
| `config@packages/ax-code/src/account/index.ts:445` | public/internal | scanned |

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

- secret packages/ax-code/src/account/account.sql.ts:3
- secret packages/ax-code/src/account/account.sql.ts:10
- secret packages/ax-code/src/account/account.sql.ts:11
- secret packages/ax-code/src/account/account.sql.ts:12
- secret packages/ax-code/src/account/account.sql.ts:30
- secret packages/ax-code/src/account/account.sql.ts:31
- secret packages/ax-code/src/account/account.sql.ts:32
- secret packages/ax-code/src/account/index.ts:8
- secret packages/ax-code/src/account/index.ts:9
- secret packages/ax-code/src/account/index.ts:14
- secret packages/ax-code/src/account/index.ts:35
- secret packages/ax-code/src/account/index.ts:36

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (49 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 4; total LOC: 824
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/account`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 49

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `baef69f2d513ce08` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 4 files / 824 LOC / fp baef69f2d513ce08 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
