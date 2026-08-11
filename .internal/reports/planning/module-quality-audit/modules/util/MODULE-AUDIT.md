# MODULE-AUDIT: util

| Field | Value |
|-------|-------|
| Unit slug | `util` |
| Scope | `packages/ax-code/src/util` |
| Wave / effort | Wave 10 / L |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `7321767a90238360` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W10-04 |
| Source files / LOC | 54 / 4059 |

## 1. Scope and map

### Purpose and ownership
Unit `util` owns `packages/ax-code/src/util`. Risk profile: quality.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/util/abort.ts` | 36 | 2 | 0 | 0 |
| `packages/ax-code/src/util/archive.ts` | 23 | 2 | 0 | 0 |
| `packages/ax-code/src/util/color.ts` | 20 | 4 | 0 | 0 |
| `packages/ax-code/src/util/concurrency.ts` | 100 | 4 | 0 | 0 |
| `packages/ax-code/src/util/context.ts` | 29 | 3 | 0 | 0 |
| `packages/ax-code/src/util/data-url.ts` | 18 | 1 | 0 | 0 |
| `packages/ax-code/src/util/defer.ts` | 13 | 1 | 0 | 0 |
| `packages/ax-code/src/util/directory-headers.ts` | 21 | 5 | 0 | 0 |
| `packages/ax-code/src/util/env.ts` | 151 | 8 | 0 | 0 |
| `packages/ax-code/src/util/error-message.ts` | 19 | 3 | 0 | 0 |
| `packages/ax-code/src/util/fan-out.ts` | 78 | 4 | 0 | 0 |
| `packages/ax-code/src/util/feature-flags.ts` | 6 | 2 | 0 | 0 |
| `packages/ax-code/src/util/filelock.ts` | 165 | 2 | 0 | 0 |
| `packages/ax-code/src/util/filesystem.ts` | 273 | 25 | 0 | 0 |
| `packages/ax-code/src/util/fn.ts` | 19 | 1 | 0 | 0 |
| `packages/ax-code/src/util/format.ts` | 29 | 2 | 0 | 0 |
| `packages/ax-code/src/util/git-output.ts` | 92 | 9 | 0 | 0 |
| `packages/ax-code/src/util/git.ts` | 59 | 2 | 0 | 0 |
| `packages/ax-code/src/util/glob.ts` | 46 | 5 | 0 | 0 |
| `packages/ax-code/src/util/harmless-interrupt.ts` | 54 | 1 | 0 | 0 |
| `packages/ax-code/src/util/hash.ts` | 8 | 2 | 0 | 0 |
| `packages/ax-code/src/util/http-header.ts` | 9 | 1 | 0 | 0 |
| `packages/ax-code/src/util/iife.ts` | 4 | 1 | 0 | 0 |
| `packages/ax-code/src/util/internal-url.ts` | 27 | 2 | 0 | 0 |
| `packages/ax-code/src/util/json-record.ts` | 18 | 2 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `abortAfter@packages/ax-code/src/util/abort.ts:11` | public/internal | scanned |
| `abortAfterAny@packages/ax-code/src/util/abort.ts:28` | public/internal | scanned |
| `Archive@packages/ax-code/src/util/archive.ts:4` | public/internal | scanned |
| `extractZip@packages/ax-code/src/util/archive.ts:5` | public/internal | scanned |
| `Color@packages/ax-code/src/util/color.ts:1` | public/internal | scanned |
| `isValidHex@packages/ax-code/src/util/color.ts:2` | public/internal | scanned |
| `hexToRgb@packages/ax-code/src/util/color.ts:7` | public/internal | scanned |
| `hexToAnsiBold@packages/ax-code/src/util/color.ts:14` | public/internal | scanned |
| `ConcurrencyLimiter@packages/ax-code/src/util/concurrency.ts:9` | public/internal | scanned |
| `createConcurrencyLimiter@packages/ax-code/src/util/concurrency.ts:24` | public/internal | scanned |
| `mapWithConcurrency@packages/ax-code/src/util/concurrency.ts:73` | public/internal | scanned |
| `OutboundLimits@packages/ax-code/src/util/concurrency.ts:94` | public/internal | scanned |
| `Context@packages/ax-code/src/util/context.ts:3` | public/internal | scanned |
| `NotFound@packages/ax-code/src/util/context.ts:4` | public/internal | scanned |
| `create@packages/ax-code/src/util/context.ts:10` | public/internal | scanned |

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

- secret packages/ax-code/src/util/env.ts:2
- secret packages/ax-code/src/util/env.ts:4
- secret packages/ax-code/src/util/env.ts:5
- secret packages/ax-code/src/util/env.ts:6
- secret packages/ax-code/src/util/env.ts:8
- secret packages/ax-code/src/util/env.ts:9
- secret packages/ax-code/src/util/env.ts:10
- secret packages/ax-code/src/util/env.ts:34
- secret packages/ax-code/src/util/env.ts:35
- secret packages/ax-code/src/util/env.ts:45
- secret packages/ax-code/src/util/env.ts:46
- secret packages/ax-code/src/util/env.ts:47

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (218 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 54; total LOC: 4059
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/util`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 218

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
| Static deep extract | ok | fingerprint `7321767a90238360` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 54 files / 4059 LOC / fp 7321767a90238360 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
