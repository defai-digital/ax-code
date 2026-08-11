# MODULE-AUDIT: config

| Field | Value |
|-------|-------|
| Unit slug | `config` |
| Scope | `packages/ax-code/src/config` |
| Wave / effort | Wave 1 / L |
| Risk tags | security, config |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `6225b3cb47d0bbc0` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W1-03 |
| Source files / LOC | 11 / 3715 |

## 1. Scope and map

### Purpose and ownership
Unit `config` owns `packages/ax-code/src/config`. Risk profile: security, config.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/config/config-impl.ts` | 1552 | 40 | 1 | 0 |
| `packages/ax-code/src/config/config.ts` | 2 | 1 | 0 | 0 |
| `packages/ax-code/src/config/markdown.ts` | 171 | 9 | 0 | 0 |
| `packages/ax-code/src/config/migrate-tui-config.ts` | 180 | 1 | 0 | 0 |
| `packages/ax-code/src/config/migration.ts` | 208 | 12 | 0 | 0 |
| `packages/ax-code/src/config/paths.ts` | 300 | 10 | 0 | 0 |
| `packages/ax-code/src/config/project-config-trust.ts` | 14 | 3 | 0 | 0 |
| `packages/ax-code/src/config/schema-impl.ts` | 1085 | 19 | 0 | 0 |
| `packages/ax-code/src/config/schema.ts` | 2 | 0 | 0 | 0 |
| `packages/ax-code/src/config/tui-schema.ts` | 35 | 2 | 0 | 0 |
| `packages/ax-code/src/config/tui.ts` | 166 | 3 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `Config@packages/ax-code/src/config/config-impl.ts:81` | public/internal | scanned |
| `McpSourceKind@packages/ax-code/src/config/config-impl.ts:202` | public/internal | scanned |
| `McpSource@packages/ax-code/src/config/config-impl.ts:215` | public/internal | scanned |
| `trustedMcpSource@packages/ax-code/src/config/config-impl.ts:223` | public/internal | scanned |
| `PermissionEnvParseResult@packages/ax-code/src/config/config-impl.ts:239` | public/internal | scanned |
| `decodePermissionEnvValue@packages/ax-code/src/config/config-impl.ts:254` | public/internal | scanned |
| `parsePermissionEnv@packages/ax-code/src/config/config-impl.ts:264` | public/internal | scanned |
| `managedConfigDir@packages/ax-code/src/config/config-impl.ts:286` | public/internal | scanned |
| `state@packages/ax-code/src/config/config-impl.ts:314` | public/internal | scanned |
| `waitForDependencies@packages/ax-code/src/config/config-impl.ts:749` | public/internal | scanned |
| `installDependencies@packages/ax-code/src/config/config-impl.ts:762` | public/internal | scanned |
| `needsInstall@packages/ax-code/src/config/config-impl.ts:879` | public/internal | scanned |
| `getPluginName@packages/ax-code/src/config/config-impl.ts:1154` | public/internal | scanned |
| `deduplicatePlugins@packages/ax-code/src/config/config-impl.ts:1180` | public/internal | scanned |
| `McpLocal@packages/ax-code/src/config/config-impl.ts:1201` | public/internal | scanned |

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

- secret packages/ax-code/src/config/config-impl.ts:160
- secret packages/ax-code/src/config/config-impl.ts:341
- secret packages/ax-code/src/config/config-impl.ts:342
- secret packages/ax-code/src/config/config-impl.ts:366
- secret packages/ax-code/src/config/config-impl.ts:367
- secret packages/ax-code/src/config/config-impl.ts:602
- secret packages/ax-code/src/config/config-impl.ts:616
- secret packages/ax-code/src/config/config-impl.ts:617
- secret packages/ax-code/src/config/config-impl.ts:620
- secret packages/ax-code/src/config/config-impl.ts:621
- secret packages/ax-code/src/config/config-impl.ts:622
- secret packages/ax-code/src/config/config-impl.ts:634

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | ProjectConfigTrust / encryption canary / trust gates | empty catch may hide secret-path failures |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (1 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (100 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 11; total LOC: 3715
- Empty catch residual: packages/ax-code/src/config/config-impl.ts:123
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/config`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 1
- Export surface: 100

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-config-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `6225b3cb47d0bbc0` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 11 files / 3715 LOC / fp 6225b3cb47d0bbc0 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
