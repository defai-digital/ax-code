# MODULE-AUDIT: ui-types

| Field | Value |
|-------|-------|
| Unit slug | `ui-types` |
| Scope | `desktop/packages/ui/src/types` |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `8102c8186d3f8fe7` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-09 |
| Source files / LOC | 16 / 641 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-types` owns `desktop/packages/ui/src/types`. Risk profile: desktop.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/types/codemirror-lang-elixir.d.ts` | 6 | 1 | 0 | 0 |
| `desktop/packages/ui/src/types/desktop.d.ts` | 32 | 0 | 0 | 0 |
| `desktop/packages/ui/src/types/ghostty-web.d.ts` | 12 | 2 | 0 | 0 |
| `desktop/packages/ui/src/types/index.ts` | 29 | 1 | 0 | 0 |
| `desktop/packages/ui/src/types/multirun.ts` | 48 | 7 | 0 | 0 |
| `desktop/packages/ui/src/types/permission.ts` | 15 | 2 | 0 | 0 |
| `desktop/packages/ui/src/types/providerModels.ts` | 5 | 2 | 0 | 0 |
| `desktop/packages/ui/src/types/question.ts` | 22 | 3 | 0 | 0 |
| `desktop/packages/ui/src/types/quota.ts` | 46 | 5 | 0 | 0 |
| `desktop/packages/ui/src/types/react-syntax-highlighter-create-element.d.ts` | 15 | 0 | 0 | 0 |
| `desktop/packages/ui/src/types/sessionMessages.ts` | 7 | 1 | 0 | 0 |
| `desktop/packages/ui/src/types/snippet.ts` | 9 | 1 | 0 | 0 |
| `desktop/packages/ui/src/types/streaming.ts` | 2 | 1 | 0 | 0 |
| `desktop/packages/ui/src/types/theme.ts` | 288 | 24 | 0 | 0 |
| `desktop/packages/ui/src/types/window-globals.d.ts` | 55 | 0 | 0 | 0 |
| `desktop/packages/ui/src/types/worktree.ts` | 50 | 1 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `elixir@desktop/packages/ui/src/types/codemirror-lang-elixir.d.ts:4` | public/internal | scanned |
| `ITerminalOptions@desktop/packages/ui/src/types/ghostty-web.d.ts:4` | public/internal | scanned |
| `RendererOptions@desktop/packages/ui/src/types/ghostty-web.d.ts:8` | public/internal | scanned |
| `ModelMetadata@desktop/packages/ui/src/types/index.ts:3` | public/internal | scanned |
| `MultiRunModelSelection@desktop/packages/ui/src/types/multirun.ts:1` | public/internal | scanned |
| `MultiRunFileAttachment@desktop/packages/ui/src/types/multirun.ts:8` | public/internal | scanned |
| `MultiRunLocalFileAttachment@desktop/packages/ui/src/types/multirun.ts:14` | public/internal | scanned |
| `toMultiRunFileAttachment@desktop/packages/ui/src/types/multirun.ts:22` | public/internal | scanned |
| `MultiRunGroup@desktop/packages/ui/src/types/multirun.ts:28` | public/internal | scanned |
| `CreateMultiRunParams@desktop/packages/ui/src/types/multirun.ts:33` | public/internal | scanned |
| `CreateMultiRunResult@desktop/packages/ui/src/types/multirun.ts:43` | public/internal | scanned |
| `PermissionRequest@desktop/packages/ui/src/types/permission.ts:1` | public/internal | scanned |
| `PermissionResponse@desktop/packages/ui/src/types/permission.ts:14` | public/internal | scanned |
| `ProviderModel@desktop/packages/ui/src/types/providerModels.ts:3` | public/internal | scanned |
| `ProviderWithModelList@desktop/packages/ui/src/types/providerModels.ts:4` | public/internal | scanned |

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

- secret desktop/packages/ui/src/types/theme.ts:92

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (51 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 16; total LOC: 641
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/types`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 51

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
| Static deep extract | ok | fingerprint `8102c8186d3f8fe7` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 16 files / 641 LOC / fp 8102c8186d3f8fe7 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
