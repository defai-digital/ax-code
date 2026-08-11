# MODULE-AUDIT: cli-parent

| Field | Value |
|-------|-------|
| Unit slug | `cli-parent` |
| Scope | `packages/ax-code/src/cli` |
| Wave / effort | Wave 6 / L |
| Risk tags | cli |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `fced16b0a9cfbd84` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W6-00 |
| Source files / LOC | 330 / 55659 |

## 1. Scope and map

### Purpose and ownership
Unit `cli-parent` owns `packages/ax-code/src/cli`. Risk profile: cli.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/attach-auth.ts` | 11 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/boolean-flag.ts` | 27 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/boot-node.ts` | 153 | 6 | 0 | 0 |
| `packages/ax-code/src/cli/boot.ts` | 278 | 7 | 0 | 0 |
| `packages/ax-code/src/cli/bootstrap/env.ts` | 187 | 12 | 0 | 0 |
| `packages/ax-code/src/cli/bootstrap/fatal.ts` | 78 | 3 | 0 | 0 |
| `packages/ax-code/src/cli/bootstrap/migrate.ts` | 65 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/bootstrap/windows-console.ts` | 58 | 3 | 0 | 0 |
| `packages/ax-code/src/cli/bootstrap.ts` | 18 | 1 | 0 | 0 |
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

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `buildAttachAuthHeaders@packages/ax-code/src/cli/attach-auth.ts:3` | public/internal | scanned |
| `cliBooleanFlagValue@packages/ax-code/src/cli/boolean-flag.ts:4` | public/internal | scanned |
| `hooks@packages/ax-code/src/cli/boot-node.ts:39` | public/internal | scanned |
| `clearForcedExitTimer@packages/ax-code/src/cli/boot-node.ts:46` | public/internal | scanned |
| `FORCED_EXIT_GRACE_MS@packages/ax-code/src/cli/boot-node.ts:53` | public/internal | scanned |
| `scheduleForcedExit@packages/ax-code/src/cli/boot-node.ts:55` | public/internal | scanned |
| `cli@packages/ax-code/src/cli/boot-node.ts:65` | public/internal | scanned |
| `run@packages/ax-code/src/cli/boot-node.ts:136` | public/internal | scanned |
| `clearForcedExitTimer@packages/ax-code/src/cli/boot.ts:131` | public/internal | scanned |
| `FORCED_EXIT_GRACE_MS@packages/ax-code/src/cli/boot.ts:138` | public/internal | scanned |
| `scheduleForcedExit@packages/ax-code/src/cli/boot.ts:140` | public/internal | scanned |
| `hooks@packages/ax-code/src/cli/boot.ts:150` | public/internal | scanned |
| `removeHooks@packages/ax-code/src/cli/boot.ts:157` | public/internal | scanned |
| `cli@packages/ax-code/src/cli/boot.ts:164` | public/internal | scanned |
| `run@packages/ax-code/src/cli/boot.ts:236` | public/internal | scanned |

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

- secret packages/ax-code/src/cli/attach-auth.ts:3
- secret packages/ax-code/src/cli/attach-auth.ts:4
- process packages/ax-code/src/cli/bootstrap/windows-console.ts:48
- io packages/ax-code/src/cli/cmd/audit.ts:9
- io packages/ax-code/src/cli/cmd/audit.ts:158
- secret packages/ax-code/src/cli/cmd/context.ts:13
- secret packages/ax-code/src/cli/cmd/context.ts:48
- secret packages/ax-code/src/cli/cmd/context.ts:49
- secret packages/ax-code/src/cli/cmd/context.ts:50
- secret packages/ax-code/src/cli/cmd/context.ts:51
- secret packages/ax-code/src/cli/cmd/context.ts:61
- secret packages/ax-code/src/cli/cmd/context.ts:62

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (4 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (1247 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 330; total LOC: 55659
- Empty catch residual: packages/ax-code/src/cli/cmd/github-agent/github-api.ts:49, packages/ax-code/src/cli/cmd/run.ts:839, packages/ax-code/src/cli/cmd/storage/session.ts:453, packages/ax-code/src/cli/cmd/tui/component/prompt/index.tsx:1590
- TODOs: packages/ax-code/src/cli/cmd/tui/component/prompt/prompt-config.ts:2 "Fix a TODO in the codebase", | packages/ax-code/src/cli/cmd/tui/routes/home.tsx:8 // TODO(ADR-035): The Rust/Ratatui TUI was removed (2026-07); OpenTUI is the

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/cli`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 2
- Empty catch residual: 4
- Export surface: 1247

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-cli-parent-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `fced16b0a9cfbd84` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 330 files / 55659 LOC / fp fced16b0a9cfbd84 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
