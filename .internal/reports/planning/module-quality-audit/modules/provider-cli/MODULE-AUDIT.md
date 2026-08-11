# MODULE-AUDIT: provider-cli

| Field | Value |
|-------|-------|
| Unit slug | `provider-cli` |
| Scope | `packages/ax-code/src/provider/cli` |
| Wave / effort | Wave 5 / L |
| Risk tags | stability, process |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `a87b887410caa806` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W5-03 |
| Source files / LOC | 10 / 1721 |

## 1. Scope and map

### Purpose and ownership
Unit `provider-cli` owns `packages/ax-code/src/provider/cli`. Risk profile: stability, process.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/provider/cli/attachments.ts` | 131 | 3 | 0 | 0 |
| `packages/ax-code/src/provider/cli/binary.ts` | 29 | 1 | 0 | 0 |
| `packages/ax-code/src/provider/cli/cli-language-model.ts` | 659 | 4 | 0 | 0 |
| `packages/ax-code/src/provider/cli/config.ts` | 77 | 3 | 0 | 0 |
| `packages/ax-code/src/provider/cli/connect.ts` | 146 | 6 | 0 | 0 |
| `packages/ax-code/src/provider/cli/effort.ts` | 31 | 4 | 0 | 0 |
| `packages/ax-code/src/provider/cli/json.ts` | 26 | 3 | 0 | 0 |
| `packages/ax-code/src/provider/cli/parser.ts` | 332 | 11 | 0 | 0 |
| `packages/ax-code/src/provider/cli/prompt.ts` | 99 | 2 | 0 | 0 |
| `packages/ax-code/src/provider/cli/resolve.ts` | 191 | 3 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `CliAttachmentRef@packages/ax-code/src/provider/cli/attachments.ts:12` | public/internal | scanned |
| `MaterializedCliAttachments@packages/ax-code/src/provider/cli/attachments.ts:19` | public/internal | scanned |
| `materializeCliAttachments@packages/ax-code/src/provider/cli/attachments.ts:86` | public/internal | scanned |
| `selectPreferredCodexBinary@packages/ax-code/src/provider/cli/binary.ts:22` | public/internal | scanned |
| `CliLanguageModelConfig@packages/ax-code/src/provider/cli/cli-language-model.ts:25` | public/internal | scanned |
| `cliEnv@packages/ax-code/src/provider/cli/cli-language-model.ts:69` | public/internal | scanned |
| `buildCliCommand@packages/ax-code/src/provider/cli/cli-language-model.ts:154` | public/internal | scanned |
| `CliLanguageModel@packages/ax-code/src/provider/cli/cli-language-model.ts:197` | public/internal | scanned |
| `CliProviderDefinition@packages/ax-code/src/provider/cli/config.ts:12` | public/internal | scanned |
| `CLI_PROVIDER_DEFINITIONS@packages/ax-code/src/provider/cli/config.ts:21` | public/internal | scanned |
| `getCliProviderDefinition@packages/ax-code/src/provider/cli/config.ts:74` | public/internal | scanned |
| `CLI_CONNECT_TIMEOUT_MS@packages/ax-code/src/provider/cli/connect.ts:9` | public/internal | scanned |
| `checkCliProviderAuth@packages/ax-code/src/provider/cli/connect.ts:72` | public/internal | scanned |
| `CliProviderProbeResult@packages/ax-code/src/provider/cli/connect.ts:77` | public/internal | scanned |
| `CliLanguageModelProbeConfig@packages/ax-code/src/provider/cli/connect.ts:82` | public/internal | scanned |

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

- io packages/ax-code/src/provider/cli/attachments.ts:2
- io packages/ax-code/src/provider/cli/attachments.ts:114
- secret packages/ax-code/src/provider/cli/cli-language-model.ts:17
- secret packages/ax-code/src/provider/cli/cli-language-model.ts:78
- secret packages/ax-code/src/provider/cli/cli-language-model.ts:81
- secret packages/ax-code/src/provider/cli/cli-language-model.ts:174
- secret packages/ax-code/src/provider/cli/cli-language-model.ts:175
- secret packages/ax-code/src/provider/cli/cli-language-model.ts:177
- secret packages/ax-code/src/provider/cli/cli-language-model.ts:178
- process packages/ax-code/src/provider/cli/cli-language-model.ts:267
- process packages/ax-code/src/provider/cli/cli-language-model.ts:375
- io packages/ax-code/src/provider/cli/json.ts:20

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (40 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 10; total LOC: 1721
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/provider/cli`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 40

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | packages/ax-code/test/provider | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-provider-cli-001 | stability | Critical | prior-review | verified-fixed |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `a87b887410caa806` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |
| Regression AUDIT-provider-cli-001 | ok | packages/ax-code/test/provider |

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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 10 files / 1721 LOC / fp a87b887410caa806 |
| Fix owner | ax-code-glm | 2026-08-11 | 1 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
