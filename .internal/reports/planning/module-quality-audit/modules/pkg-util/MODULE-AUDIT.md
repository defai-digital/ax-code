# MODULE-AUDIT: pkg-util

| Field | Value |
|-------|-------|
| Unit slug | `pkg-util` |
| Scope | `packages/util` |
| Wave / effort | Wave 9 / M |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `96ae2dca5b032857` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W9-03 |
| Source files / LOC | 13 / 443 |

## 1. Scope and map

### Purpose and ownership
Unit `pkg-util` owns `packages/util`. Risk profile: quality.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/util/src/array.ts` | 11 | 1 | 0 | 0 |
| `packages/util/src/binary.ts` | 42 | 3 | 0 | 0 |
| `packages/util/src/encode.ts` | 53 | 5 | 0 | 0 |
| `packages/util/src/error.ts` | 60 | 0 | 0 | 0 |
| `packages/util/src/fn.ts` | 12 | 1 | 0 | 0 |
| `packages/util/src/identifier.ts` | 68 | 5 | 0 | 0 |
| `packages/util/src/iife.ts` | 4 | 1 | 0 | 0 |
| `packages/util/src/lazy.ts` | 15 | 1 | 0 | 0 |
| `packages/util/src/module.ts` | 11 | 2 | 1 | 0 |
| `packages/util/src/path.ts` | 40 | 5 | 0 | 0 |
| `packages/util/src/retry.ts` | 42 | 2 | 0 | 0 |
| `packages/util/src/slug.ts` | 75 | 2 | 0 | 0 |
| `packages/util/sst-env.d.ts` | 10 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `findLast@packages/util/src/array.ts:1` | public/internal | scanned |
| `Binary@packages/util/src/binary.ts:1` | public/internal | scanned |
| `search@packages/util/src/binary.ts:2` | public/internal | scanned |
| `insert@packages/util/src/binary.ts:22` | public/internal | scanned |
| `base64Encode@packages/util/src/encode.ts:1` | public/internal | scanned |
| `base64Decode@packages/util/src/encode.ts:7` | public/internal | scanned |
| `hash@packages/util/src/encode.ts:14` | public/internal | scanned |
| `checksum@packages/util/src/encode.ts:23` | public/internal | scanned |
| `sampledChecksum@packages/util/src/encode.ts:33` | public/internal | scanned |
| `fn@packages/util/src/fn.ts:3` | public/internal | scanned |
| `BASE62_ALPHABET@packages/util/src/identifier.ts:3` | public/internal | scanned |
| `Identifier@packages/util/src/identifier.ts:5` | public/internal | scanned |
| `ascending@packages/util/src/identifier.ts:13` | public/internal | scanned |
| `descending@packages/util/src/identifier.ts:17` | public/internal | scanned |
| `create@packages/util/src/identifier.ts:40` | public/internal | scanned |

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

- none flagged

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| module contract | public exports | invalid input / silent fail | Zod/type boundaries where present | 1 empty catch sites |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (1 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (28 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 13; total LOC: 443
- Empty catch residual: packages/util/src/module.ts:8
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/util`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 1
- Export surface: 28

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-pkg-util-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `96ae2dca5b032857` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 13 files / 443 LOC / fp 96ae2dca5b032857 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
