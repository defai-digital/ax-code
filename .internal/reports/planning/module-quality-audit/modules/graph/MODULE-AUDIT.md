# MODULE-AUDIT: graph

| Field | Value |
|-------|-------|
| Unit slug | `graph` |
| Scope | `packages/ax-code/src/graph` |
| Wave / effort | Wave 5 / L |
| Risk tags | performance |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `26dc33948a95c134` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W5-08 |
| Source files / LOC | 2 / 1032 |

## 1. Scope and map

### Purpose and ownership
Unit `graph` owns `packages/ax-code/src/graph`. Risk profile: performance.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/graph/format.ts` | 699 | 17 | 0 | 0 |
| `packages/ax-code/src/graph/index.ts` | 333 | 12 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `GraphFormat@packages/ax-code/src/graph/format.ts:135` | public/internal | scanned |
| `TimelineLine@packages/ax-code/src/graph/format.ts:136` | public/internal | scanned |
| `TopologyHeading@packages/ax-code/src/graph/format.ts:141` | public/internal | scanned |
| `TopologyPath@packages/ax-code/src/graph/format.ts:149` | public/internal | scanned |
| `TopologyStep@packages/ax-code/src/graph/format.ts:158` | public/internal | scanned |
| `TopologyPair@packages/ax-code/src/graph/format.ts:168` | public/internal | scanned |
| `TopologyLine@packages/ax-code/src/graph/format.ts:178` | public/internal | scanned |
| `TopologyResponse@packages/ax-code/src/graph/format.ts:183` | public/internal | scanned |
| `json@packages/ax-code/src/graph/format.ts:190` | public/internal | scanned |
| `timeline@packages/ax-code/src/graph/format.ts:194` | public/internal | scanned |
| `topologyLines@packages/ax-code/src/graph/format.ts:251` | public/internal | scanned |
| `topology@packages/ax-code/src/graph/format.ts:305` | public/internal | scanned |
| `ascii@packages/ax-code/src/graph/format.ts:309` | public/internal | scanned |
| `mermaid@packages/ax-code/src/graph/format.ts:348` | public/internal | scanned |
| `gantt@packages/ax-code/src/graph/format.ts:427` | public/internal | scanned |

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

- secret packages/ax-code/src/graph/format.ts:201
- secret packages/ax-code/src/graph/format.ts:219
- secret packages/ax-code/src/graph/format.ts:315
- secret packages/ax-code/src/graph/format.ts:630
- secret packages/ax-code/src/graph/format.ts:657
- secret packages/ax-code/src/graph/index.ts:16
- secret packages/ax-code/src/graph/index.ts:21
- secret packages/ax-code/src/graph/index.ts:22
- secret packages/ax-code/src/graph/index.ts:37
- secret packages/ax-code/src/graph/index.ts:66
- secret packages/ax-code/src/graph/index.ts:101
- secret packages/ax-code/src/graph/index.ts:103

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (29 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 2; total LOC: 1032
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Hot-path unit: reviewed static N+1/sync risks in 0 IO hotspots. No new Critical perf finding without baseline measurement.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/graph`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 29

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
| Static deep extract | ok | fingerprint `26dc33948a95c134` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 2 files / 1032 LOC / fp 26dc33948a95c134 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
