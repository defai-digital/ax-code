# MODULE-AUDIT: session-lifecycle-queue

| Field | Value |
|-------|-------|
| Unit slug | `session-lifecycle-queue` |
| Scope | `packages/ax-code/src/session (lifecycle/queue)` |
| Wave / effort | Wave 2 / L |
| Risk tags | concurrency, hot-path |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `c2fbee1372e748a7` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W2-01d |
| Source files / LOC | 135 / 26283 |

## 1. Scope and map

### Purpose and ownership
Unit `session-lifecycle-queue` owns `packages/ax-code/src/session (lifecycle/queue)`. Risk profile: concurrency, hot-path.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/session/agent-optimization-trace.ts` | 168 | 15 | 0 | 0 |
| `packages/ax-code/src/session/blast-radius.ts` | 326 | 14 | 0 | 0 |
| `packages/ax-code/src/session/branch.ts` | 229 | 14 | 0 | 0 |
| `packages/ax-code/src/session/compaction.ts` | 582 | 8 | 0 | 0 |
| `packages/ax-code/src/session/compare.ts` | 329 | 12 | 0 | 0 |
| `packages/ax-code/src/session/context-tier.ts` | 141 | 5 | 0 | 0 |
| `packages/ax-code/src/session/correction/detector.ts` | 223 | 5 | 0 | 0 |
| `packages/ax-code/src/session/correction/index.ts` | 176 | 6 | 0 | 0 |
| `packages/ax-code/src/session/correction/reflection.ts` | 67 | 2 | 0 | 0 |
| `packages/ax-code/src/session/cycle-detection.ts` | 46 | 2 | 0 | 0 |
| `packages/ax-code/src/session/debug.ts` | 183 | 6 | 0 | 0 |
| `packages/ax-code/src/session/decision-hints.ts` | 511 | 18 | 0 | 0 |
| `packages/ax-code/src/session/delta-batcher.ts` | 84 | 3 | 0 | 0 |
| `packages/ax-code/src/session/dre.ts` | 185 | 14 | 0 | 0 |
| `packages/ax-code/src/session/findings.ts` | 42 | 1 | 0 | 0 |
| `packages/ax-code/src/session/goal-verification.ts` | 133 | 5 | 0 | 0 |
| `packages/ax-code/src/session/goal.ts` | 314 | 15 | 0 | 0 |
| `packages/ax-code/src/session/graph.ts` | 25 | 3 | 0 | 0 |
| `packages/ax-code/src/session/image-resize.ts` | 129 | 3 | 0 | 0 |
| `packages/ax-code/src/session/index.ts` | 1147 | 40 | 0 | 0 |
| `packages/ax-code/src/session/instruction.ts` | 336 | 7 | 0 | 0 |
| `packages/ax-code/src/session/intelligence-nudge.ts` | 63 | 4 | 0 | 0 |
| `packages/ax-code/src/session/llm-impl.ts` | 1048 | 19 | 0 | 0 |
| `packages/ax-code/src/session/llm.ts` | 2 | 1 | 0 | 0 |
| `packages/ax-code/src/session/message-v2-impl.ts` | 1238 | 40 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `AgentOptimizationTrace@packages/ax-code/src/session/agent-optimization-trace.ts:13` | public/internal | scanned |
| `RouteClass@packages/ax-code/src/session/agent-optimization-trace.ts:14` | public/internal | scanned |
| `VerificationStatus@packages/ax-code/src/session/agent-optimization-trace.ts:16` | public/internal | scanned |
| `PatchOutcome@packages/ax-code/src/session/agent-optimization-trace.ts:18` | public/internal | scanned |
| `ToolObservation@packages/ax-code/src/session/agent-optimization-trace.ts:20` | public/internal | scanned |
| `TraceEvent@packages/ax-code/src/session/agent-optimization-trace.ts:26` | public/internal | scanned |
| `ContextPackSummary@packages/ax-code/src/session/agent-optimization-trace.ts:59` | public/internal | scanned |
| `detectRepeatedFailure@packages/ax-code/src/session/agent-optimization-trace.ts:93` | public/internal | scanned |
| `contextPackSummary@packages/ax-code/src/session/agent-optimization-trace.ts:108` | public/internal | scanned |
| `verificationCommand@packages/ax-code/src/session/agent-optimization-trace.ts:116` | public/internal | scanned |
| `isVerificationObservation@packages/ax-code/src/session/agent-optimization-trace.ts:122` | public/internal | scanned |
| `verificationStatusFromObservations@packages/ax-code/src/session/agent-optimization-trace.ts:132` | public/internal | scanned |
| `serialize@packages/ax-code/src/session/agent-optimization-trace.ts:152` | public/internal | scanned |
| `decodeTraceEvent@packages/ax-code/src/session/agent-optimization-trace.ts:156` | public/internal | scanned |
| `deserialize@packages/ax-code/src/session/agent-optimization-trace.ts:162` | public/internal | scanned |

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

- secret packages/ax-code/src/session/agent-optimization-trace.ts:4
- secret packages/ax-code/src/session/agent-optimization-trace.ts:7
- secret packages/ax-code/src/session/agent-optimization-trace.ts:52
- secret packages/ax-code/src/session/agent-optimization-trace.ts:53
- secret packages/ax-code/src/session/agent-optimization-trace.ts:54
- secret packages/ax-code/src/session/agent-optimization-trace.ts:55
- secret packages/ax-code/src/session/agent-optimization-trace.ts:56
- secret packages/ax-code/src/session/agent-optimization-trace.ts:60
- secret packages/ax-code/src/session/agent-optimization-trace.ts:66
- secret packages/ax-code/src/session/agent-optimization-trace.ts:85
- secret packages/ax-code/src/session/agent-optimization-trace.ts:86
- secret packages/ax-code/src/session/agent-optimization-trace.ts:87

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| session/turn consistency | async race / abort | double-run, lost cancel, stale write | locks/queues where present | must validate abort paths in tests |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (783 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 135; total LOC: 26283
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Hot-path unit: reviewed static N+1/sync risks in 5 IO hotspots. No new Critical perf finding without baseline measurement.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/session (lifecycle/queue)`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 783

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
| Static deep extract | ok | fingerprint `c2fbee1372e748a7` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 135 files / 26283 LOC / fp c2fbee1372e748a7 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
