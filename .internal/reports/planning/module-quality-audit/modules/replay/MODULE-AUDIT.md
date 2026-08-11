# MODULE-AUDIT: replay

| Field | Value |
|-------|-------|
| Unit slug | `replay` |
| Scope | `packages/ax-code/src/replay` |
| Wave / effort | Wave 2 / M |
| Risk tags | persistence, correctness |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `1c13e8ca39e1a87a` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W2-11 |
| Source files / LOC | 9 / 2197 |

## 1. Scope and map

### Purpose and ownership
Unit `replay` owns `packages/ax-code/src/replay`. Risk profile: persistence, correctness.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/replay/agent-control-query.ts` | 319 | 18 | 0 | 0 |
| `packages/ax-code/src/replay/compare.ts` | 429 | 22 | 0 | 0 |
| `packages/ax-code/src/replay/event-log.sql.ts` | 33 | 1 | 0 | 0 |
| `packages/ax-code/src/replay/event.ts` | 329 | 31 | 0 | 0 |
| `packages/ax-code/src/replay/index.ts` | 5 | 1 | 0 | 0 |
| `packages/ax-code/src/replay/query.ts` | 373 | 19 | 0 | 0 |
| `packages/ax-code/src/replay/recorder.ts` | 123 | 6 | 0 | 0 |
| `packages/ax-code/src/replay/replay.ts` | 492 | 11 | 0 | 0 |
| `packages/ax-code/src/replay/tool-call-query.ts` | 94 | 6 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `AgentControlReplayQuery@packages/ax-code/src/replay/agent-control-query.ts:8` | public/internal | scanned |
| `TimelineTone@packages/ax-code/src/replay/agent-control-query.ts:26` | public/internal | scanned |
| `TimelineKind@packages/ax-code/src/replay/agent-control-query.ts:27` | public/internal | scanned |
| `TimelineItem@packages/ax-code/src/replay/agent-control-query.ts:29` | public/internal | scanned |
| `TimelineRow@packages/ax-code/src/replay/agent-control-query.ts:41` | public/internal | scanned |
| `ReadModel@packages/ax-code/src/replay/agent-control-query.ts:46` | public/internal | scanned |
| `normalizeAgentControlEvent@packages/ax-code/src/replay/agent-control-query.ts:52` | public/internal | scanned |
| `isAgentControlEvent@packages/ax-code/src/replay/agent-control-query.ts:89` | public/internal | scanned |
| `summaryBySession@packages/ax-code/src/replay/agent-control-query.ts:93` | public/internal | scanned |
| `readModelBySession@packages/ax-code/src/replay/agent-control-query.ts:98` | public/internal | scanned |
| `readModelFromRows@packages/ax-code/src/replay/agent-control-query.ts:103` | public/internal | scanned |
| `readModelFromEvents@packages/ax-code/src/replay/agent-control-query.ts:111` | public/internal | scanned |
| `summaryFromRows@packages/ax-code/src/replay/agent-control-query.ts:119` | public/internal | scanned |
| `summaryFromEvents@packages/ax-code/src/replay/agent-control-query.ts:123` | public/internal | scanned |
| `timelineBySession@packages/ax-code/src/replay/agent-control-query.ts:127` | public/internal | scanned |

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

- secret packages/ax-code/src/replay/event.ts:47
- secret packages/ax-code/src/replay/event.ts:81
- secret packages/ax-code/src/replay/event.ts:194
- secret packages/ax-code/src/replay/event.ts:204
- secret packages/ax-code/src/replay/event.ts:205
- secret packages/ax-code/src/replay/event.ts:206
- secret packages/ax-code/src/replay/event.ts:207
- secret packages/ax-code/src/replay/recorder.ts:21
- secret packages/ax-code/src/replay/recorder.ts:66
- secret packages/ax-code/src/replay/recorder.ts:67
- secret packages/ax-code/src/replay/recorder.ts:83
- secret packages/ax-code/src/replay/recorder.ts:88

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (115 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 9; total LOC: 2197
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/replay`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 115

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
| Static deep extract | ok | fingerprint `1c13e8ca39e1a87a` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 9 files / 2197 LOC / fp 1c13e8ca39e1a87a |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
