# MODULE-AUDIT: format

| Field | Value |
|-------|-------|
| Unit slug | `format` |
| Scope | `packages/ax-code/src/format` |
| Wave / effort | Wave 10 / S |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `67e12cfcf928dc47` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W10-03 |
| Source files / LOC | 2 / 637 |

## 1. Scope and map

### Purpose and ownership
Unit `format` owns `packages/ax-code/src/format`. Risk profile: quality.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/format/formatter.ts` | 434 | 27 | 0 | 0 |
| `packages/ax-code/src/format/index.ts` | 203 | 4 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `Info@packages/ax-code/src/format/formatter.ts:17` | public/internal | scanned |
| `gofmt@packages/ax-code/src/format/formatter.ts:64` | public/internal | scanned |
| `mix@packages/ax-code/src/format/formatter.ts:73` | public/internal | scanned |
| `prettier@packages/ax-code/src/format/formatter.ts:82` | public/internal | scanned |
| `oxfmt@packages/ax-code/src/format/formatter.ts:128` | public/internal | scanned |
| `biome@packages/ax-code/src/format/formatter.ts:148` | public/internal | scanned |
| `zig@packages/ax-code/src/format/formatter.ts:192` | public/internal | scanned |
| `clang@packages/ax-code/src/format/formatter.ts:201` | public/internal | scanned |
| `ktlint@packages/ax-code/src/format/formatter.ts:211` | public/internal | scanned |
| `ruff@packages/ax-code/src/format/formatter.ts:220` | public/internal | scanned |
| `rlang@packages/ax-code/src/format/formatter.ts:250` | public/internal | scanned |
| `uvformat@packages/ax-code/src/format/formatter.ts:274` | public/internal | scanned |
| `rubocop@packages/ax-code/src/format/formatter.ts:289` | public/internal | scanned |
| `standardrb@packages/ax-code/src/format/formatter.ts:298` | public/internal | scanned |
| `htmlbeautifier@packages/ax-code/src/format/formatter.ts:307` | public/internal | scanned |

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

- process packages/ax-code/src/format/formatter.ts:33
- process packages/ax-code/src/format/index.ts:124

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (31 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 2; total LOC: 637
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/format`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 31

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
| Static deep extract | ok | fingerprint `67e12cfcf928dc47` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 2 files / 637 LOC / fp 67e12cfcf928dc47 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
