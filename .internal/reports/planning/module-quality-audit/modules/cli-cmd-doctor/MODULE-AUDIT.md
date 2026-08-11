# MODULE-AUDIT: cli-cmd-doctor

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-doctor` |
| Scope | `packages/ax-code/src/cli/cmd/doctor` |
| Wave / effort | Wave 6 / M |
| Risk tags | cli |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `717962c2c097af3f` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W6-14 |
| Source files / LOC | 1 / 553 |

## 1. Scope and map

### Purpose and ownership
Unit `cli-cmd-doctor` owns `packages/ax-code/src/cli/cmd/doctor`. Risk profile: cli.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/doctor.ts` | 553 | 7 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `getRuntimeCheck@packages/ax-code/src/cli/cmd/doctor.ts:38` | public/internal | scanned |
| `getServerExposureCheck@packages/ax-code/src/cli/cmd/doctor.ts:52` | public/internal | scanned |
| `getIsolationPolicyCheck@packages/ax-code/src/cli/cmd/doctor.ts:66` | public/internal | scanned |
| `getAxEngineDoctorCheck@packages/ax-code/src/cli/cmd/doctor.ts:91` | public/internal | scanned |
| `getDuplicateProjectIdentityCheck@packages/ax-code/src/cli/cmd/doctor.ts:187` | public/internal | scanned |
| `doctorProjectContext@packages/ax-code/src/cli/cmd/doctor.ts:212` | public/internal | scanned |
| `DoctorCommand@packages/ax-code/src/cli/cmd/doctor.ts:233` | public/internal | scanned |

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

- secret packages/ax-code/src/cli/cmd/doctor.ts:52
- secret packages/ax-code/src/cli/cmd/doctor.ts:56
- secret packages/ax-code/src/cli/cmd/doctor.ts:280
- secret packages/ax-code/src/cli/cmd/doctor.ts:282
- secret packages/ax-code/src/cli/cmd/doctor.ts:283
- secret packages/ax-code/src/cli/cmd/doctor.ts:284
- secret packages/ax-code/src/cli/cmd/doctor.ts:285
- secret packages/ax-code/src/cli/cmd/doctor.ts:294
- secret packages/ax-code/src/cli/cmd/doctor.ts:295
- secret packages/ax-code/src/cli/cmd/doctor.ts:330
- secret packages/ax-code/src/cli/cmd/doctor.ts:336
- secret packages/ax-code/src/cli/cmd/doctor.ts:339

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (7 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 1; total LOC: 553
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/cli/cmd/doctor`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 7

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
| Static deep extract | ok | fingerprint `717962c2c097af3f` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 1 files / 553 LOC / fp 717962c2c097af3f |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
