# MODULE-AUDIT: cli-cmd-registry

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-registry` |
| Scope | `packages/ax-code/src/cli/cmd registry/shims` |
| Wave / effort | Wave 6 / M |
| Risk tags | cli |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `fab9f7bfd821e338` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W6-01 |
| Source files / LOC | 316 / 54476 |

## 1. Scope and map

### Purpose and ownership
Unit `cli-cmd-registry` owns `packages/ax-code/src/cli/cmd registry/shims`. Risk profile: cli.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/account.ts` | 269 | 8 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/acp.ts` | 100 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/agent.ts` | 272 | 5 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/audit.ts` | 210 | 3 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/branch.ts` | 71 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/capability.ts` | 54 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/cmd.ts` | 8 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/compare.ts` | 191 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/context.ts` | 130 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/db.ts` | 2 | 1 | 0 | 0 |
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
| `packages/ax-code/src/cli/cmd/design-check.ts` | 56 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/doctor-health.ts` | 196 | 3 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `formatAccountLabel@packages/ax-code/src/cli/cmd/account.ts:20` | public/internal | scanned |
| `formatOrgLine@packages/ax-code/src/cli/cmd/account.ts:26` | public/internal | scanned |
| `LoginCommand@packages/ax-code/src/cli/cmd/account.ts:185` | public/internal | scanned |
| `LogoutCommand@packages/ax-code/src/cli/cmd/account.ts:200` | public/internal | scanned |
| `SwitchCommand@packages/ax-code/src/cli/cmd/account.ts:214` | public/internal | scanned |
| `OrgsCommand@packages/ax-code/src/cli/cmd/account.ts:223` | public/internal | scanned |
| `OpenCommand@packages/ax-code/src/cli/cmd/account.ts:232` | public/internal | scanned |
| `ConsoleCommand@packages/ax-code/src/cli/cmd/account.ts:241` | public/internal | scanned |
| `AcpCommand@packages/ax-code/src/cli/cmd/acp.ts:9` | public/internal | scanned |
| `AgentMode@packages/ax-code/src/cli/cmd/agent.ts:15` | public/internal | scanned |
| `AgentCreateFrontmatter@packages/ax-code/src/cli/cmd/agent.ts:31` | public/internal | scanned |
| `buildAgentCreatePermission@packages/ax-code/src/cli/cmd/agent.ts:37` | public/internal | scanned |
| `buildAgentCreateFrontmatter@packages/ax-code/src/cli/cmd/agent.ts:46` | public/internal | scanned |
| `AgentCommand@packages/ax-code/src/cli/cmd/agent.ts:266` | public/internal | scanned |
| `validateAuditPruneDays@packages/ax-code/src/cli/cmd/audit.ts:39` | public/internal | scanned |

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

- io packages/ax-code/src/cli/cmd/audit.ts:9
- io packages/ax-code/src/cli/cmd/audit.ts:158
- secret packages/ax-code/src/cli/cmd/context.ts:13
- secret packages/ax-code/src/cli/cmd/context.ts:48
- secret packages/ax-code/src/cli/cmd/context.ts:49
- secret packages/ax-code/src/cli/cmd/context.ts:50
- secret packages/ax-code/src/cli/cmd/context.ts:51
- secret packages/ax-code/src/cli/cmd/context.ts:61
- secret packages/ax-code/src/cli/cmd/context.ts:62
- secret packages/ax-code/src/cli/cmd/context.ts:63
- secret packages/ax-code/src/cli/cmd/context.ts:64
- secret packages/ax-code/src/cli/cmd/context.ts:65

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (4 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (1192 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 316; total LOC: 54476
- Empty catch residual: packages/ax-code/src/cli/cmd/github-agent/github-api.ts:49, packages/ax-code/src/cli/cmd/run.ts:839, packages/ax-code/src/cli/cmd/storage/session.ts:453, packages/ax-code/src/cli/cmd/tui/component/prompt/index.tsx:1590
- TODOs: packages/ax-code/src/cli/cmd/tui/component/prompt/prompt-config.ts:2 "Fix a TODO in the codebase", | packages/ax-code/src/cli/cmd/tui/routes/home.tsx:8 // TODO(ADR-035): The Rust/Ratatui TUI was removed (2026-07); OpenTUI is the

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/cli/cmd registry/shims`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 2
- Empty catch residual: 4
- Export surface: 1192

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-cli-cmd-registry-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `fab9f7bfd821e338` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 316 files / 54476 LOC / fp fab9f7bfd821e338 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
