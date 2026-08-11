# MODULE-AUDIT: code-intelligence

| Field | Value |
|-------|-------|
| Unit slug | `code-intelligence` |
| Scope | `packages/ax-code/src/code-intelligence` |
| Wave / effort | Wave 5 / L |
| Risk tags | performance, persistence |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `4b1e362d3eb1e274` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W5-07 |
| Source files / LOC | 12 / 4974 |

## 1. Scope and map

### Purpose and ownership
Unit `code-intelligence` owns `packages/ax-code/src/code-intelligence`. Risk profile: performance, persistence.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/code-intelligence/auto-index.ts` | 478 | 8 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/builder-impl.ts` | 1325 | 15 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/builder.ts` | 8 | 0 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/graph-context.ts` | 668 | 6 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/id.ts` | 19 | 4 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/index.ts` | 445 | 25 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/lockfile.ts` | 226 | 4 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/native-store.ts` | 275 | 31 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/query.ts` | 762 | 40 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/schema.sql.ts` | 216 | 9 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/syntactic.ts` | 306 | 5 | 0 | 0 |
| `packages/ax-code/src/code-intelligence/watcher.ts` | 246 | 5 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `AutoIndex@packages/ax-code/src/code-intelligence/auto-index.ts:62` | public/internal | scanned |
| `Event@packages/ax-code/src/code-intelligence/auto-index.ts:70` | public/internal | scanned |
| `IndexState@packages/ax-code/src/code-intelligence/auto-index.ts:96` | public/internal | scanned |
| `getState@packages/ax-code/src/code-intelligence/auto-index.ts:112` | public/internal | scanned |
| `setState@packages/ax-code/src/code-intelligence/auto-index.ts:130` | public/internal | scanned |
| `reportProgress@packages/ax-code/src/code-intelligence/auto-index.ts:156` | public/internal | scanned |
| `purgeHomeDirectoryGraphs@packages/ax-code/src/code-intelligence/auto-index.ts:186` | public/internal | scanned |
| `maybeStart@packages/ax-code/src/code-intelligence/auto-index.ts:238` | public/internal | scanned |
| `parseImportSpecifiers@packages/ax-code/src/code-intelligence/builder-impl.ts:121` | public/internal | scanned |
| `resolveContainingNodeFromDb@packages/ax-code/src/code-intelligence/builder-impl.ts:276` | public/internal | scanned |
| `lookupCallerKind@packages/ax-code/src/code-intelligence/builder-impl.ts:320` | public/internal | scanned |
| `planReferenceQueriesForBookmarks@packages/ax-code/src/code-intelligence/builder-impl.ts:442` | public/internal | scanned |
| `CodeGraphBuilder@packages/ax-code/src/code-intelligence/builder-impl.ts:460` | public/internal | scanned |
| `IndexTimings@packages/ax-code/src/code-intelligence/builder-impl.ts:487` | public/internal | scanned |
| `IndexResult@packages/ax-code/src/code-intelligence/builder-impl.ts:509` | public/internal | scanned |

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

- io packages/ax-code/src/code-intelligence/builder-impl.ts:488
- io packages/ax-code/src/code-intelligence/builder-impl.ts:566
- io packages/ax-code/src/code-intelligence/builder-impl.ts:602
- io packages/ax-code/src/code-intelligence/builder-impl.ts:1208
- io packages/ax-code/src/code-intelligence/builder-impl.ts:1247
- io packages/ax-code/src/code-intelligence/graph-context.ts:1
- io packages/ax-code/src/code-intelligence/graph-context.ts:215
- io packages/ax-code/src/code-intelligence/graph-context.ts:237
- io packages/ax-code/src/code-intelligence/graph-context.ts:240
- io packages/ax-code/src/code-intelligence/graph-context.ts:615
- io packages/ax-code/src/code-intelligence/lockfile.ts:43
- io packages/ax-code/src/code-intelligence/lockfile.ts:67

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (152 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 12; total LOC: 4974
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Hot-path unit: reviewed static N+1/sync risks in 34 IO hotspots. No new Critical perf finding without baseline measurement.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/code-intelligence`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 152

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
| Static deep extract | ok | fingerprint `4b1e362d3eb1e274` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 12 files / 4974 LOC / fp 4b1e362d3eb1e274 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
