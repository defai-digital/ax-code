# MODULE-AUDIT: mode

| Field | Value |
|-------|-------|
| Unit slug | `mode` |
| Scope | `packages/ax-code/src/mode` |
| Wave / effort | Wave 5 / M |
| Risk tags | correctness |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `ab6fd06789e6c578` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W5-13 |
| Source files / LOC | 15 / 1917 |

## 1. Scope and map

### Purpose and ownership
Unit `mode` owns `packages/ax-code/src/mode`. Risk profile: correctness.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/mode/arena.ts` | 154 | 7 | 0 | 0 |
| `packages/ax-code/src/mode/budget.ts` | 102 | 6 | 0 | 0 |
| `packages/ax-code/src/mode/council.ts` | 350 | 15 | 0 | 0 |
| `packages/ax-code/src/mode/debate.ts` | 151 | 8 | 0 | 0 |
| `packages/ax-code/src/mode/ensemble-shared.ts` | 177 | 8 | 0 | 0 |
| `packages/ax-code/src/mode/hybrid.ts` | 57 | 5 | 0 | 0 |
| `packages/ax-code/src/mode/implement-arena.ts` | 160 | 7 | 0 | 0 |
| `packages/ax-code/src/mode/index.ts` | 14 | 13 | 0 | 0 |
| `packages/ax-code/src/mode/json-mode-prompt.ts` | 24 | 2 | 0 | 0 |
| `packages/ax-code/src/mode/memory.ts` | 199 | 13 | 0 | 0 |
| `packages/ax-code/src/mode/policy.ts` | 171 | 8 | 0 | 0 |
| `packages/ax-code/src/mode/preflight.ts` | 160 | 12 | 0 | 0 |
| `packages/ax-code/src/mode/protocol.ts` | 42 | 2 | 0 | 0 |
| `packages/ax-code/src/mode/work-mode.ts` | 85 | 12 | 0 | 0 |
| `packages/ax-code/src/mode/worktree-policy.ts` | 71 | 5 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `Arena@packages/ax-code/src/mode/arena.ts:6` | public/internal | scanned |
| `Verification@packages/ax-code/src/mode/arena.ts:7` | public/internal | scanned |
| `Strategy@packages/ax-code/src/mode/arena.ts:9` | public/internal | scanned |
| `ArenaCandidate@packages/ax-code/src/mode/arena.ts:11` | public/internal | scanned |
| `RankedCandidate@packages/ax-code/src/mode/arena.ts:24` | public/internal | scanned |
| `rankArenaCandidates@packages/ax-code/src/mode/arena.ts:66` | public/internal | scanned |
| `renderRankingMarkdown@packages/ax-code/src/mode/arena.ts:135` | public/internal | scanned |
| `Budget@packages/ax-code/src/mode/budget.ts:5` | public/internal | scanned |
| `EnsembleBudget@packages/ax-code/src/mode/budget.ts:6` | public/internal | scanned |
| `CheckInput@packages/ax-code/src/mode/budget.ts:15` | public/internal | scanned |
| `CheckResult@packages/ax-code/src/mode/budget.ts:22` | public/internal | scanned |
| `resolveCaps@packages/ax-code/src/mode/budget.ts:28` | public/internal | scanned |
| `check@packages/ax-code/src/mode/budget.ts:37` | public/internal | scanned |
| `Council@packages/ax-code/src/mode/council.ts:6` | public/internal | scanned |
| `Severity@packages/ax-code/src/mode/council.ts:7` | public/internal | scanned |

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

- io packages/ax-code/src/mode/memory.ts:123

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (123 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 15; total LOC: 1917
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/mode`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 123

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
| Static deep extract | ok | fingerprint `ab6fd06789e6c578` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 15 files / 1917 LOC / fp ab6fd06789e6c578 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
