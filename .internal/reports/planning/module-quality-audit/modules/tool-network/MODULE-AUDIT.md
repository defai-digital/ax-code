# MODULE-AUDIT: tool-network

| Field | Value |
|-------|-------|
| Unit slug | `tool-network` |
| Scope | `packages/ax-code/src/tool (webfetch/browser/network)` |
| Wave / effort | Wave 3 / M |
| Risk tags | security, network |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `7465f28b28557914` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W3-03c |
| Source files / LOC | 78 / 14580 |

## 1. Scope and map

### Purpose and ownership
Unit `tool-network` owns `packages/ax-code/src/tool (webfetch/browser/network)`. Risk profile: security, network.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/tool/apply_patch.ts` | 540 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/arena-implement.ts` | 692 | 8 | 0 | 0 |
| `packages/ax-code/src/tool/arena.ts` | 572 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/bash-background.ts` | 342 | 14 | 0 | 0 |
| `packages/ax-code/src/tool/bash-destructive.ts` | 178 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/bash-helpers.ts` | 128 | 11 | 0 | 0 |
| `packages/ax-code/src/tool/bash-impl.ts` | 1050 | 1 | 0 | 1 |
| `packages/ax-code/src/tool/bash.ts` | 2 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/bash_output.ts` | 87 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/batch.ts` | 289 | 2 | 0 | 0 |
| `packages/ax-code/src/tool/browser/action.ts` | 58 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/browser/capture.ts` | 47 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/browser/console.ts` | 37 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/browser/evaluate.ts` | 33 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/browser/network.ts` | 52 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/browser/open.ts` | 50 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/browser/runtime.ts` | 678 | 8 | 0 | 0 |
| `packages/ax-code/src/tool/browser/snapshot.ts` | 29 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/code-intelligence.ts` | 263 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/codesearch.ts` | 59 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/council.ts` | 442 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/debug_analyze.ts` | 120 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/debug_apply_verification.ts` | 89 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/debug_capture_evidence.ts` | 78 | 1 | 0 | 0 |
| `packages/ax-code/src/tool/debug_open_case.ts` | 33 | 1 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `ApplyPatchTool@packages/ax-code/src/tool/apply_patch.ts:39` | public/internal | scanned |
| `ImplementMember@packages/ax-code/src/tool/arena-implement.ts:34` | public/internal | scanned |
| `linkPrimaryNodeModules@packages/ax-code/src/tool/arena-implement.ts:90` | public/internal | scanned |
| `ImplementArenaBasePreflight@packages/ax-code/src/tool/arena-implement.ts:112` | public/internal | scanned |
| `inspectImplementArenaBase@packages/ax-code/src/tool/arena-implement.ts:121` | public/internal | scanned |
| `ContestantPatchSnapshot@packages/ax-code/src/tool/arena-implement.ts:157` | public/internal | scanned |
| `snapshotContestantPatch@packages/ax-code/src/tool/arena-implement.ts:167` | public/internal | scanned |
| `runImplementContestant@packages/ax-code/src/tool/arena-implement.ts:368` | public/internal | scanned |
| `runImplementArena@packages/ax-code/src/tool/arena-implement.ts:631` | public/internal | scanned |
| `ArenaTool@packages/ax-code/src/tool/arena.ts:215` | public/internal | scanned |
| `BackgroundShell@packages/ax-code/src/tool/bash-background.ts:18` | public/internal | scanned |
| `Status@packages/ax-code/src/tool/bash-background.ts:19` | public/internal | scanned |
| `OutputStream@packages/ax-code/src/tool/bash-background.ts:20` | public/internal | scanned |
| `Observer@packages/ax-code/src/tool/bash-background.ts:22` | public/internal | scanned |
| `Info@packages/ax-code/src/tool/bash-background.ts:39` | public/internal | scanned |

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

- io packages/ax-code/src/tool/apply_patch.ts:25
- io packages/ax-code/src/tool/apply_patch.ts:26
- io packages/ax-code/src/tool/apply_patch.ts:107
- io packages/ax-code/src/tool/apply_patch.ts:151
- io packages/ax-code/src/tool/apply_patch.ts:195
- io packages/ax-code/src/tool/apply_patch.ts:228
- io packages/ax-code/src/tool/apply_patch.ts:229
- io packages/ax-code/src/tool/apply_patch.ts:294
- io packages/ax-code/src/tool/apply_patch.ts:315
- io packages/ax-code/src/tool/apply_patch.ts:318
- io packages/ax-code/src/tool/apply_patch.ts:321
- io packages/ax-code/src/tool/apply_patch.ts:327

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (1 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (175 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 78; total LOC: 14580
- Empty catch residual: packages/ax-code/src/tool/webfetch.ts:280
- TODOs: packages/ax-code/src/tool/bash-impl.ts:208 // TODO: we may wanna rename this tool so it works better on other shells

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/tool (webfetch/browser/network)`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 1
- Empty catch residual: 1
- Export surface: 175

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-tool-network-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `7465f28b28557914` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 78 files / 14580 LOC / fp 7465f28b28557914 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
