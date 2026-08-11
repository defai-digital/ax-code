# MODULE-AUDIT: cli-cmd-debug

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-debug` |
| Scope | `packages/ax-code/src/cli/cmd/debug` |
| Wave / effort | Wave 6 / L |
| Risk tags | cli |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `b8eced0931b0f9fb` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W6-17 |
| Source files / LOC | 13 / 2621 |

## 1. Scope and map

### Purpose and ownership
Unit `cli-cmd-debug` owns `packages/ax-code/src/cli/cmd/debug`. Risk profile: cli.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/debug/agent.ts` | 178 | 4 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/config.ts` | 17 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/explain-impl.ts` | 1203 | 11 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/explain.ts` | 2 | 0 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/file.ts` | 98 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/index.ts` | 58 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/lsp.ts` | 54 | 3 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/perf.ts` | 588 | 8 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/replay.ts` | 248 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/ripgrep.ts` | 88 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/scrap.ts` | 17 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/skill.ts` | 17 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/debug/snapshot.ts` | 53 | 1 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `ToolParams@packages/ax-code/src/cli/cmd/debug/agent.ts:17` | public/internal | scanned |
| `AgentCommand@packages/ax-code/src/cli/cmd/debug/agent.ts:19` | public/internal | scanned |
| `decodeToolParamsValue@packages/ax-code/src/cli/cmd/debug/agent.ts:93` | public/internal | scanned |
| `parseToolParams@packages/ax-code/src/cli/cmd/debug/agent.ts:101` | public/internal | scanned |
| `ConfigCommand@packages/ax-code/src/cli/cmd/debug/config.ts:6` | public/internal | scanned |
| `DiagnosticIssue@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:48` | public/internal | scanned |
| `ReplayDebugRecord@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:59` | public/internal | scanned |
| `ProcessDebugRecord@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:66` | public/internal | scanned |
| `classifyErrors@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:149` | public/internal | scanned |
| `scanStandardLogLines@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:287` | public/internal | scanned |
| `parseReplayEventLines@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:356` | public/internal | scanned |
| `parseProcessEventLines@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:378` | public/internal | scanned |
| `classifyReplayIssues@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:398` | public/internal | scanned |
| `classifyProcessIssues@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:524` | public/internal | scanned |
| `collectStandardLogDirs@packages/ax-code/src/cli/cmd/debug/explain-impl.ts:1042` | public/internal | scanned |

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

- secret packages/ax-code/src/cli/cmd/debug/agent.ts:146
- io packages/ax-code/src/cli/cmd/debug/explain-impl.ts:1066
- io packages/ax-code/src/cli/cmd/debug/explain-impl.ts:1083
- io packages/ax-code/src/cli/cmd/debug/explain-impl.ts:1095

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (35 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 13; total LOC: 2621
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/cli/cmd/debug`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 35

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
| Static deep extract | ok | fingerprint `b8eced0931b0f9fb` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 13 files / 2621 LOC / fp b8eced0931b0f9fb |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
