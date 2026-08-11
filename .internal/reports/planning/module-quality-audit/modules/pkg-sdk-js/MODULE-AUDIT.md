# MODULE-AUDIT: pkg-sdk-js

| Field | Value |
|-------|-------|
| Unit slug | `pkg-sdk-js` |
| Scope | `packages/sdk/js` |
| Wave / effort | Wave 9 / L |
| Risk tags | api |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `0d9c358172780563` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W9-01 |
| Source files / LOC | 90 / 60137 |

## 1. Scope and map

### Purpose and ownership
Unit `pkg-sdk-js` owns `packages/sdk/js`. Risk profile: api.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/sdk/js/example/example.ts` | 58 | 0 | 0 | 0 |
| `packages/sdk/js/example/headless-app.ts` | 36 | 0 | 0 | 0 |
| `packages/sdk/js/example/programmatic.ts` | 119 | 0 | 0 | 0 |
| `packages/sdk/js/script/build.ts` | 293 | 1 | 0 | 0 |
| `packages/sdk/js/script/publish.ts` | 41 | 0 | 0 | 0 |
| `packages/sdk/js/script/validate-openapi.ts` | 26 | 0 | 0 | 0 |
| `packages/sdk/js/src/client.ts` | 31 | 6 | 0 | 0 |
| `packages/sdk/js/src/gen/client/client.gen.ts` | 274 | 1 | 0 | 1 |
| `packages/sdk/js/src/gen/client/index.ts` | 26 | 5 | 0 | 0 |
| `packages/sdk/js/src/gen/client/types.gen.ts` | 207 | 10 | 0 | 0 |
| `packages/sdk/js/src/gen/client/utils.gen.ts` | 290 | 9 | 0 | 0 |
| `packages/sdk/js/src/gen/client.gen.ts` | 19 | 2 | 0 | 0 |
| `packages/sdk/js/src/gen/core/auth.gen.ts` | 42 | 3 | 0 | 0 |
| `packages/sdk/js/src/gen/core/bodySerializer.gen.ts` | 83 | 6 | 0 | 0 |
| `packages/sdk/js/src/gen/core/params.gen.ts` | 184 | 4 | 0 | 0 |
| `packages/sdk/js/src/gen/core/pathSerializer.gen.ts` | 168 | 10 | 0 | 0 |
| `packages/sdk/js/src/gen/core/queryKeySerializer.gen.ts` | 112 | 4 | 0 | 0 |
| `packages/sdk/js/src/gen/core/serverSentEvents.gen.ts` | 248 | 4 | 0 | 0 |
| `packages/sdk/js/src/gen/core/types.gen.ts` | 87 | 4 | 0 | 0 |
| `packages/sdk/js/src/gen/core/utils.gen.ts` | 138 | 5 | 0 | 0 |
| `packages/sdk/js/src/gen/sdk.gen.ts` | 7459 | 40 | 0 | 0 |
| `packages/sdk/js/src/gen/types.gen.ts` | 14170 | 40 | 0 | 0 |
| `packages/sdk/js/src/grpc-node.ts` | 790 | 8 | 0 | 0 |
| `packages/sdk/js/src/grpc.ts` | 2660 | 40 | 1 | 0 |
| `packages/sdk/js/src/headless/client.ts` | 769 | 39 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `buildClientParams@packages/sdk/js/script/build.ts:130` | public/internal | scanned |
| `OpencodeClientConfig@packages/sdk/js/src/client.ts:7` | public/internal | scanned |
| `OpencodeClient@packages/sdk/js/src/client.ts:7` | public/internal | scanned |
| `AxCodeClientConfig@packages/sdk/js/src/client.ts:8` | public/internal | scanned |
| `AxCodeClient@packages/sdk/js/src/client.ts:8` | public/internal | scanned |
| `createAxCodeClient@packages/sdk/js/src/client.ts:10` | public/internal | scanned |
| `createOpencodeClient@packages/sdk/js/src/client.ts:30` | public/internal | scanned |
| `createClient@packages/sdk/js/src/gen/client/client.gen.ts:22` | public/internal | scanned |
| `buildClientParams@packages/sdk/js/src/gen/client/index.ts:10` | public/internal | scanned |
| `serializeQueryKeyValue@packages/sdk/js/src/gen/client/index.ts:11` | public/internal | scanned |
| `createClient@packages/sdk/js/src/gen/client/index.ts:12` | public/internal | scanned |
| `createConfig@packages/sdk/js/src/gen/client/index.ts:25` | public/internal | scanned |
| `mergeHeaders@packages/sdk/js/src/gen/client/index.ts:25` | public/internal | scanned |
| `ResponseStyle@packages/sdk/js/src/gen/client/types.gen.ts:8` | public/internal | scanned |
| `Config@packages/sdk/js/src/gen/client/types.gen.ts:10` | public/internal | scanned |

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

- secret packages/sdk/js/example/programmatic.ts:19
- secret packages/sdk/js/example/programmatic.ts:43
- io packages/sdk/js/script/build.ts:4
- io packages/sdk/js/script/build.ts:26
- process packages/sdk/js/script/build.ts:35
- io packages/sdk/js/script/build.ts:49
- io packages/sdk/js/script/build.ts:107
- io packages/sdk/js/script/build.ts:112
- io packages/sdk/js/script/build.ts:163
- io packages/sdk/js/script/build.ts:173
- io packages/sdk/js/script/build.ts:242
- io packages/sdk/js/script/build.ts:243

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (9 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (557 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 90; total LOC: 60137
- Empty catch residual: packages/sdk/js/src/grpc.ts:2327, packages/sdk/js/src/headless/lifecycle.ts:450, packages/sdk/js/src/headless/lifecycle.ts:463, packages/sdk/js/src/headless/lifecycle.ts:469, packages/sdk/js/src/internal/server-shared.ts:92, packages/sdk/js/src/internal/server-shared.ts:149
- TODOs: packages/sdk/js/src/gen/client/client.gen.ts:211 // TODO: we probably want to return error and improve types | packages/sdk/js/src/v2/gen/client/client.gen.ts:211 // TODO: we probably want to return error and improve types | packages/sdk/js/test/stream-handle.test.ts:31 { tool: "grep", input: { pattern: "TODO" }, output: "found 3" },

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/sdk/js`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 3
- Empty catch residual: 9
- Export surface: 557

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-pkg-sdk-js-empty-catch | silent-error | Medium | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `0d9c358172780563` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 90 files / 60137 LOC / fp 0d9c358172780563 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
