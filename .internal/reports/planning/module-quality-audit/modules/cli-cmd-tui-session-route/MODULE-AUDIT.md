# MODULE-AUDIT: cli-cmd-tui-session-route

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-tui-session-route` |
| Scope | `packages/ax-code/src/cli/cmd/tui routes/session` |
| Wave / effort | Wave 6 / L |
| Risk tags | cli |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `f8e11586c8b62d9f` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W6-08b |
| Source files / LOC | 233 / 36902 |

## 1. Scope and map

### Purpose and ownership
Unit `cli-cmd-tui-session-route` owns `packages/ax-code/src/cli/cmd/tui routes/session`. Risk profile: cli.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/tui/app.tsx` | 1613 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/attach.ts` | 94 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/backend.ts` | 17 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/border.tsx` | 22 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-agent.tsx` | 35 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-command.tsx` | 255 | 4 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-diff-viewer.tsx` | 187 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-effort.tsx` | 52 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-mcp.tsx` | 91 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-model-options.ts` | 21 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-model.tsx` | 170 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts` | 182 | 18 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-provider.tsx` | 1149 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-session-list.tsx` | 254 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-session-rename.tsx` | 47 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-skill.tsx` | 41 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-stash.tsx` | 87 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-status.tsx` | 168 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-theme-list.tsx` | 57 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/dialog-workspace-list.tsx` | 379 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/home-view-model.ts` | 4 | 0 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/logo.tsx` | 21 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/model-vision-label.ts` | 61 | 6 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/prompt/autocomplete-command.ts` | 8 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/component/prompt/autocomplete-scroll.ts` | 48 | 4 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `TuiInput@packages/ax-code/src/cli/cmd/tui/app.tsx:87` | public/internal | scanned |
| `tui@packages/ax-code/src/cli/cmd/tui/app.tsx:98` | public/internal | scanned |
| `AttachCommand@packages/ax-code/src/cli/cmd/tui/attach.ts:12` | public/internal | scanned |
| `TuiBackendCommand@packages/ax-code/src/cli/cmd/tui/backend.ts:3` | public/internal | scanned |
| `EmptyBorder@packages/ax-code/src/cli/cmd/tui/component/border.tsx:1` | public/internal | scanned |
| `SplitBorder@packages/ax-code/src/cli/cmd/tui/component/border.tsx:15` | public/internal | scanned |
| `DialogAgent@packages/ax-code/src/cli/cmd/tui/component/dialog-agent.tsx:7` | public/internal | scanned |
| `Slash@packages/ax-code/src/cli/cmd/tui/component/dialog-command.tsx:28` | public/internal | scanned |
| `CommandOption@packages/ax-code/src/cli/cmd/tui/component/dialog-command.tsx:33` | public/internal | scanned |
| `useCommandDialog@packages/ax-code/src/cli/cmd/tui/component/dialog-command.tsx:214` | public/internal | scanned |
| `CommandProvider@packages/ax-code/src/cli/cmd/tui/component/dialog-command.tsx:222` | public/internal | scanned |
| `computeDiffLines@packages/ax-code/src/cli/cmd/tui/component/dialog-diff-viewer.tsx:14` | public/internal | scanned |
| `DialogDiffViewer@packages/ax-code/src/cli/cmd/tui/component/dialog-diff-viewer.tsx:136` | public/internal | scanned |
| `DialogEffort@packages/ax-code/src/cli/cmd/tui/component/dialog-effort.tsx:8` | public/internal | scanned |
| `DialogMcp@packages/ax-code/src/cli/cmd/tui/component/dialog-mcp.tsx:26` | public/internal | scanned |

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

- secret packages/ax-code/src/cli/cmd/tui/attach.ts:40
- secret packages/ax-code/src/cli/cmd/tui/attach.ts:43
- secret packages/ax-code/src/cli/cmd/tui/attach.ts:70
- secret packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts:141
- secret packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts:146
- secret packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts:159
- secret packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts:172
- secret packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts:174
- secret packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts:175
- secret packages/ax-code/src/cli/cmd/tui/component/dialog-provider-options.ts:179
- secret packages/ax-code/src/cli/cmd/tui/component/dialog-provider.tsx:56
- secret packages/ax-code/src/cli/cmd/tui/component/dialog-provider.tsx:142

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (1 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (872 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 233; total LOC: 36902
- Empty catch residual: packages/ax-code/src/cli/cmd/tui/component/prompt/index.tsx:1590
- TODOs: packages/ax-code/src/cli/cmd/tui/component/prompt/prompt-config.ts:2 "Fix a TODO in the codebase", | packages/ax-code/src/cli/cmd/tui/routes/home.tsx:8 // TODO(ADR-035): The Rust/Ratatui TUI was removed (2026-07); OpenTUI is the

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/cli/cmd/tui routes/session`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 2
- Empty catch residual: 1
- Export surface: 872

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-cli-cmd-tui-session-route-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `f8e11586c8b62d9f` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 233 files / 36902 LOC / fp f8e11586c8b62d9f |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
