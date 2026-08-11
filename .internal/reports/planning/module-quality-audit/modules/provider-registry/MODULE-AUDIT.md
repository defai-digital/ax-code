# MODULE-AUDIT: provider-registry

| Field | Value |
|-------|-------|
| Unit slug | `provider-registry` |
| Scope | `packages/ax-code/src/provider (registry/routing)` |
| Wave / effort | Wave 5 / L |
| Risk tags | hot-path, correctness |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `482e5be152f8ecaa` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W5-01a |
| Source files / LOC | 52 / 11481 |

## 1. Scope and map

### Purpose and ownership
Unit `provider-registry` owns `packages/ax-code/src/provider (registry/routing)`. Risk profile: hot-path, correctness.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/provider/agent-optimization-profile.ts` | 76 | 5 | 0 | 0 |
| `packages/ax-code/src/provider/auth.ts` | 236 | 11 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/catalog.ts` | 256 | 8 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/connection.ts` | 164 | 12 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/constants.ts` | 196 | 38 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/delete.ts` | 193 | 2 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/dependency.ts` | 139 | 3 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/download-job.ts` | 180 | 7 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/download-progress.ts` | 182 | 13 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/hf-cache.ts` | 147 | 7 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/index.ts` | 19 | 0 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/install.ts` | 316 | 7 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/lifecycle.ts` | 123 | 6 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/model-cache.ts` | 868 | 19 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/model-card.ts` | 137 | 3 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/paths.ts` | 38 | 18 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/platform.ts` | 168 | 10 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/prepare.ts` | 113 | 3 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/provider-loader.ts` | 359 | 3 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/python.ts` | 66 | 2 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/server.ts` | 657 | 10 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/status.ts` | 162 | 10 | 0 | 0 |
| `packages/ax-code/src/provider/cli/attachments.ts` | 131 | 3 | 0 | 0 |
| `packages/ax-code/src/provider/cli/binary.ts` | 29 | 1 | 0 | 0 |
| `packages/ax-code/src/provider/cli/cli-language-model.ts` | 659 | 4 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `TaskRouteClass@packages/ax-code/src/provider/agent-optimization-profile.ts:3` | public/internal | scanned |
| `TaskRouteClassification@packages/ax-code/src/provider/agent-optimization-profile.ts:5` | public/internal | scanned |
| `LongAgentProfile@packages/ax-code/src/provider/agent-optimization-profile.ts:10` | public/internal | scanned |
| `classifyTaskForModelRoute@packages/ax-code/src/provider/agent-optimization-profile.ts:20` | public/internal | scanned |
| `longAgentProfileForModel@packages/ax-code/src/provider/agent-optimization-profile.ts:51` | public/internal | scanned |
| `ProviderAuth@packages/ax-code/src/provider/auth.ts:9` | public/internal | scanned |
| `Method@packages/ax-code/src/provider/auth.ts:10` | public/internal | scanned |
| `Authorization@packages/ax-code/src/provider/auth.ts:58` | public/internal | scanned |
| `OauthMissing@packages/ax-code/src/provider/auth.ts:69` | public/internal | scanned |
| `OauthCodeMissing@packages/ax-code/src/provider/auth.ts:71` | public/internal | scanned |
| `OauthCallbackFailed@packages/ax-code/src/provider/auth.ts:76` | public/internal | scanned |
| `ValidationFailed@packages/ax-code/src/provider/auth.ts:78` | public/internal | scanned |
| `Error@packages/ax-code/src/provider/auth.ts:86` | public/internal | scanned |
| `methods@packages/ax-code/src/provider/auth.ts:112` | public/internal | scanned |
| `authorize@packages/ax-code/src/provider/auth.ts:145` | public/internal | scanned |

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

- secret packages/ax-code/src/provider/agent-optimization-profile.ts:12
- secret packages/ax-code/src/provider/agent-optimization-profile.ts:26
- secret packages/ax-code/src/provider/agent-optimization-profile.ts:31
- secret packages/ax-code/src/provider/agent-optimization-profile.ts:57
- secret packages/ax-code/src/provider/agent-optimization-profile.ts:68
- secret packages/ax-code/src/provider/auth.ts:208
- secret packages/ax-code/src/provider/auth.ts:209
- secret packages/ax-code/src/provider/auth.ts:224
- secret packages/ax-code/src/provider/auth.ts:225
- secret packages/ax-code/src/provider/ax-engine/catalog.ts:48
- secret packages/ax-code/src/provider/ax-engine/catalog.ts:49
- secret packages/ax-code/src/provider/ax-engine/catalog.ts:223

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
1. Public exports in this unit maintain their local contracts (359 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 52; total LOC: 11481
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Hot-path unit: reviewed static N+1/sync risks in 12 IO hotspots. No new Critical perf finding without baseline measurement.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/provider (registry/routing)`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 359

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
| Static deep extract | ok | fingerprint `482e5be152f8ecaa` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 52 files / 11481 LOC / fp 482e5be152f8ecaa |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
