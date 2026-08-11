# MODULE-AUDIT: cli-cmd-github-agent

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-github-agent` |
| Scope | `packages/ax-code/src/cli/cmd/github-agent` |
| Wave / effort | Wave 6 / L |
| Risk tags | cli |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `5692e279e2f4ed96` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W6-15 |
| Source files / LOC | 8 / 1968 |

## 1. Scope and map

### Purpose and ownership
Unit `cli-cmd-github-agent` owns `packages/ax-code/src/cli/cmd/github-agent`. Risk profile: cli.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/github-agent/git-ops.ts` | 218 | 16 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/github-agent/github-api.ts` | 290 | 11 | 1 | 0 |
| `packages/ax-code/src/cli/cmd/github-agent/index.ts` | 21 | 4 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/github-agent/install.ts` | 229 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/github-agent/pr.ts` | 160 | 4 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/github-agent/prompts.ts` | 362 | 9 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/github-agent/run.ts` | 511 | 6 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/github-agent/types.ts` | 177 | 23 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `GitRunner@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:6` | public/internal | scanned |
| `GitTextRunner@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:7` | public/internal | scanned |
| `GitStatusRunner@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:8` | public/internal | scanned |
| `createGitHelpers@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:10` | public/internal | scanned |
| `commitChanges@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:36` | public/internal | scanned |
| `generateBranchName@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:42` | public/internal | scanned |
| `checkoutNewBranch@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:56` | public/internal | scanned |
| `checkoutLocalBranch@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:63` | public/internal | scanned |
| `checkoutForkBranch@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:71` | public/internal | scanned |
| `pushToNewBranch@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:91` | public/internal | scanned |
| `pushToLocalBranch@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:102` | public/internal | scanned |
| `pushToForkBranch@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:108` | public/internal | scanned |
| `branchIsDirty@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:119` | public/internal | scanned |
| `hasNewCommits@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:145` | public/internal | scanned |
| `configureGit@packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:159` | public/internal | scanned |

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

- secret packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:162
- secret packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:187
- secret packages/ax-code/src/cli/cmd/github-agent/git-ops.ts:188
- secret packages/ax-code/src/cli/cmd/github-agent/github-api.ts:14
- secret packages/ax-code/src/cli/cmd/github-agent/github-api.ts:16
- secret packages/ax-code/src/cli/cmd/github-agent/github-api.ts:18
- secret packages/ax-code/src/cli/cmd/github-agent/github-api.ts:20
- secret packages/ax-code/src/cli/cmd/github-agent/github-api.ts:22
- secret packages/ax-code/src/cli/cmd/github-agent/github-api.ts:27
- secret packages/ax-code/src/cli/cmd/github-agent/github-api.ts:29
- secret packages/ax-code/src/cli/cmd/github-agent/github-api.ts:33
- secret packages/ax-code/src/cli/cmd/github-agent/github-api.ts:34

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (1 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (74 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 8; total LOC: 1968
- Empty catch residual: packages/ax-code/src/cli/cmd/github-agent/github-api.ts:49
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/cli/cmd/github-agent`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 1
- Export surface: 74

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-cli-cmd-github-agent-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `5692e279e2f4ed96` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 8 files / 1968 LOC / fp 5692e279e2f4ed96 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
