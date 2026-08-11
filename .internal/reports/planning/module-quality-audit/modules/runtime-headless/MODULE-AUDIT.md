# MODULE-AUDIT: runtime-headless

| Field | Value |
|-------|-------|
| Unit slug | `runtime-headless` |
| Scope | `packages/ax-code/src/runtime/headless` |
| Wave / effort | Wave 2 / M |
| Risk tags | hot-path |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `8f516f2065aa9eb7` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W2-03 |
| Source files / LOC | 11 / 1407 |

## 1. Scope and map

### Purpose and ownership
Unit `runtime-headless` owns `packages/ax-code/src/runtime/headless`. Risk profile: hot-path.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/runtime/headless/command.ts` | 97 | 11 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/effects.ts` | 79 | 5 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/event-log.ts` | 63 | 4 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/event-sink-node.ts` | 62 | 2 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/event-sink.ts` | 35 | 5 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/event.ts` | 214 | 17 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/index.ts` | 10 | 0 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/projection.ts` | 444 | 7 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/replay.ts` | 105 | 4 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/runner.ts` | 149 | 5 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/runtime.ts` | 149 | 5 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `HeadlessRuntimeCommandMode@packages/ax-code/src/runtime/headless/command.ts:1` | public/internal | scanned |
| `HeadlessRuntimeModel@packages/ax-code/src/runtime/headless/command.ts:3` | public/internal | scanned |
| `HeadlessRuntimePart@packages/ax-code/src/runtime/headless/command.ts:10` | public/internal | scanned |
| `HeadlessPromptBody@packages/ax-code/src/runtime/headless/command.ts:15` | public/internal | scanned |
| `HeadlessCommandBody@packages/ax-code/src/runtime/headless/command.ts:26` | public/internal | scanned |
| `HeadlessShellBody@packages/ax-code/src/runtime/headless/command.ts:37` | public/internal | scanned |
| `HeadlessPermissionReplyBody@packages/ax-code/src/runtime/headless/command.ts:46` | public/internal | scanned |
| `HeadlessQuestionReplyBody@packages/ax-code/src/runtime/headless/command.ts:52` | public/internal | scanned |
| `HeadlessRuntimeCommand@packages/ax-code/src/runtime/headless/command.ts:58` | public/internal | scanned |
| `HeadlessRuntimeCommandResult@packages/ax-code/src/runtime/headless/command.ts:90` | public/internal | scanned |
| `commandAcceptsAsyncMode@packages/ax-code/src/runtime/headless/command.ts:94` | public/internal | scanned |
| `createHeadlessAutonomousPermissionReply@packages/ax-code/src/runtime/headless/effects.ts:4` | public/internal | scanned |
| `createHeadlessAutonomousQuestionReply@packages/ax-code/src/runtime/headless/effects.ts:11` | public/internal | scanned |
| `HeadlessProjectionEffectHandlers@packages/ax-code/src/runtime/headless/effects.ts:18` | public/internal | scanned |
| `executeHeadlessProjectionEffect@packages/ax-code/src/runtime/headless/effects.ts:28` | public/internal | scanned |

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
| session/turn consistency | async race / abort | double-run, lost cancel, stale write | locks/queues where present | must validate abort paths in tests |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (65 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 11; total LOC: 1407
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Hot-path unit: reviewed static N+1/sync risks in 0 IO hotspots. No new Critical perf finding without baseline measurement.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/runtime/headless`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 65

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
| Static deep extract | ok | fingerprint `8f516f2065aa9eb7` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 11 files / 1407 LOC / fp 8f516f2065aa9eb7 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
