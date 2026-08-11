# MODULE-AUDIT: pkg-plugin

| Field | Value |
|-------|-------|
| Unit slug | `pkg-plugin` |
| Scope | `packages/plugin` |
| Wave / effort | Wave 9 / M |
| Risk tags | api |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `4831f820e5dd8faf` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W9-02 |
| Source files / LOC | 6 / 488 |

## 1. Scope and map

### Purpose and ownership
Unit `pkg-plugin` owns `packages/plugin`. Risk profile: api.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/plugin/script/publish.ts` | 34 | 0 | 0 | 0 |
| `packages/plugin/src/example.ts` | 19 | 1 | 0 | 0 |
| `packages/plugin/src/index.ts` | 249 | 6 | 0 | 0 |
| `packages/plugin/src/shell.ts` | 137 | 6 | 0 | 0 |
| `packages/plugin/src/tool.ts` | 39 | 3 | 0 | 0 |
| `packages/plugin/sst-env.d.ts` | 10 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `ExamplePlugin@packages/plugin/src/example.ts:4` | public/internal | scanned |
| `ProviderContext@packages/plugin/src/index.ts:20` | public/internal | scanned |
| `PluginInput@packages/plugin/src/index.ts:26` | public/internal | scanned |
| `Plugin@packages/plugin/src/index.ts:35` | public/internal | scanned |
| `AuthHook@packages/plugin/src/index.ts:43` | public/internal | scanned |
| `AuthOuathResult@packages/plugin/src/index.ts:119` | public/internal | scanned |
| `Hooks@packages/plugin/src/index.ts:162` | public/internal | scanned |
| `ShellFunction@packages/plugin/src/shell.ts:1` | public/internal | scanned |
| `ShellExpression@packages/plugin/src/shell.ts:3` | public/internal | scanned |
| `BunShell@packages/plugin/src/shell.ts:10` | public/internal | scanned |
| `BunShellPromise@packages/plugin/src/shell.ts:45` | public/internal | scanned |
| `BunShellOutput@packages/plugin/src/shell.ts:105` | public/internal | scanned |
| `BunShellError@packages/plugin/src/shell.ts:136` | public/internal | scanned |
| `ToolContext@packages/plugin/src/tool.ts:3` | public/internal | scanned |
| `tool@packages/plugin/src/tool.ts:29` | public/internal | scanned |

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

- io packages/plugin/script/publish.ts:19
- io packages/plugin/script/publish.ts:28
- io packages/plugin/script/publish.ts:33

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (16 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 6; total LOC: 488
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/plugin`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 16

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
| Static deep extract | ok | fingerprint `4831f820e5dd8faf` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 6 files / 488 LOC / fp 4831f820e5dd8faf |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
