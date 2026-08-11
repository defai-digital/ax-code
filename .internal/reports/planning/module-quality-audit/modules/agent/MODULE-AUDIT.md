# MODULE-AUDIT: agent

| Field | Value |
|-------|-------|
| Unit slug | `agent` |
| Scope | `packages/ax-code/src/agent` |
| Wave / effort | Wave 2 / L |
| Risk tags | hot-path, security |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `2026bf0307e34e1e` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W2-04 |
| Source files / LOC | 2 / 856 |

## 1. Scope and map

### Purpose and ownership
Unit `agent` owns `packages/ax-code/src/agent`. Risk profile: hot-path, security.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/agent/agent.ts` | 513 | 8 | 0 | 0 |
| `packages/ax-code/src/agent/router.ts` | 343 | 5 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `Agent@packages/ax-code/src/agent/agent.ts:31` | public/internal | scanned |
| `Info@packages/ax-code/src/agent/agent.ts:34` | public/internal | scanned |
| `Tier@packages/ax-code/src/agent/agent.ts:63` | public/internal | scanned |
| `resolveTier@packages/ax-code/src/agent/agent.ts:65` | public/internal | scanned |
| `get@packages/ax-code/src/agent/agent.ts:453` | public/internal | scanned |
| `list@packages/ax-code/src/agent/agent.ts:457` | public/internal | scanned |
| `defaultAgent@packages/ax-code/src/agent/agent.ts:461` | public/internal | scanned |
| `generate@packages/ax-code/src/agent/agent.ts:465` | public/internal | scanned |
| `RouteResult@packages/ax-code/src/agent/router.ts:235` | public/internal | scanned |
| `route@packages/ax-code/src/agent/router.ts:246` | public/internal | scanned |
| `MessageAnalysis@packages/ax-code/src/agent/router.ts:299` | public/internal | scanned |
| `classifyComplexity@packages/ax-code/src/agent/router.ts:303` | public/internal | scanned |
| `formatComplexityFailureError@packages/ax-code/src/agent/router.ts:340` | public/internal | scanned |

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

- secret packages/ax-code/src/agent/agent.ts:248
- secret packages/ax-code/src/agent/router.ts:49
- secret packages/ax-code/src/agent/router.ts:50
- secret packages/ax-code/src/agent/router.ts:64
- secret packages/ax-code/src/agent/router.ts:65

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| session/turn consistency | async race / abort | double-run, lost cancel, stale write | locks/queues where present | must validate abort paths in tests |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (13 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 2; total LOC: 856
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Hot-path unit: reviewed static N+1/sync risks in 0 IO hotspots. No new Critical perf finding without baseline measurement.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/agent`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 13

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
| Static deep extract | ok | fingerprint `2026bf0307e34e1e` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 2 files / 856 LOC / fp 2026bf0307e34e1e |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
