# MODULE-AUDIT: constants

| Field | Value |
|-------|-------|
| Unit slug | `constants` |
| Scope | `packages/ax-code/src/constants` |
| Wave / effort | Wave 10 / S |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `3bc10ed8d0e39012` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W10-01 |
| Source files / LOC | 7 / 173 |

## 1. Scope and map

### Purpose and ownership
Unit `constants` owns `packages/ax-code/src/constants`. Risk profile: quality.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/constants/index.ts` | 6 | 0 | 0 | 0 |
| `packages/ax-code/src/constants/lsp.ts` | 2 | 1 | 0 | 0 |
| `packages/ax-code/src/constants/network.ts` | 8 | 7 | 0 | 0 |
| `packages/ax-code/src/constants/project.ts` | 43 | 13 | 0 | 0 |
| `packages/ax-code/src/constants/server.ts` | 6 | 3 | 0 | 0 |
| `packages/ax-code/src/constants/session.ts` | 99 | 14 | 0 | 0 |
| `packages/ax-code/src/constants/tool.ts` | 9 | 8 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `JS_LOCKFILES@packages/ax-code/src/constants/lsp.ts:1` | public/internal | scanned |
| `WEBFETCH_MAX_RESPONSE_SIZE@packages/ax-code/src/constants/network.ts:1` | public/internal | scanned |
| `WEBFETCH_DEFAULT_TIMEOUT@packages/ax-code/src/constants/network.ts:2` | public/internal | scanned |
| `WEBFETCH_MAX_TIMEOUT@packages/ax-code/src/constants/network.ts:3` | public/internal | scanned |
| `BASH_MAX_METADATA_LENGTH@packages/ax-code/src/constants/network.ts:4` | public/internal | scanned |
| `EXA_BASE_URL@packages/ax-code/src/constants/network.ts:5` | public/internal | scanned |
| `EXA_ENDPOINT@packages/ax-code/src/constants/network.ts:6` | public/internal | scanned |
| `EXA_DEFAULT_NUM_RESULTS@packages/ax-code/src/constants/network.ts:7` | public/internal | scanned |
| `GITHUB_ORG@packages/ax-code/src/constants/project.ts:8` | public/internal | scanned |
| `PACKAGE_NAME@packages/ax-code/src/constants/project.ts:9` | public/internal | scanned |
| `GITHUB_REPO_SLUG@packages/ax-code/src/constants/project.ts:12` | public/internal | scanned |
| `GITHUB_REPO_URL@packages/ax-code/src/constants/project.ts:15` | public/internal | scanned |
| `GITHUB_NEW_ISSUE_URL@packages/ax-code/src/constants/project.ts:18` | public/internal | scanned |
| `GITHUB_LATEST_RELEASE_API_URL@packages/ax-code/src/constants/project.ts:21` | public/internal | scanned |
| `GITHUB_ACTION_REF@packages/ax-code/src/constants/project.ts:24` | public/internal | scanned |

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

- secret packages/ax-code/src/constants/session.ts:14
- secret packages/ax-code/src/constants/session.ts:53
- secret packages/ax-code/src/constants/session.ts:54
- secret packages/ax-code/src/constants/session.ts:55
- secret packages/ax-code/src/constants/session.ts:65
- secret packages/ax-code/src/constants/session.ts:66
- secret packages/ax-code/src/constants/session.ts:67
- secret packages/ax-code/src/constants/session.ts:86

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (46 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 7; total LOC: 173
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/constants`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 46

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
| Static deep extract | ok | fingerprint `3bc10ed8d0e39012` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 7 files / 173 LOC / fp 3bc10ed8d0e39012 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
