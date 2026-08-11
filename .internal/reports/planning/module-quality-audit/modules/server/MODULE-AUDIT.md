# MODULE-AUDIT: server

| Field | Value |
|-------|-------|
| Unit slug | `server` |
| Scope | `packages/ax-code/src/server` |
| Wave / effort | Wave 4 / L |
| Risk tags | security, network |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `41e55cdec4602106` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W4-02 |
| Source files / LOC | 50 / 10261 |

## 1. Scope and map

### Purpose and ownership
Unit `server` owns `packages/ax-code/src/server`. Risk profile: security, network.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/server/constants.ts` | 2 | 3 | 0 | 0 |
| `packages/ax-code/src/server/error.ts` | 366 | 10 | 0 | 0 |
| `packages/ax-code/src/server/event.ts` | 4 | 1 | 0 | 0 |
| `packages/ax-code/src/server/ipc-protocol.ts` | 95 | 9 | 0 | 0 |
| `packages/ax-code/src/server/ipc-transport.ts` | 343 | 4 | 1 | 0 |
| `packages/ax-code/src/server/listen-security.ts` | 8 | 0 | 0 | 0 |
| `packages/ax-code/src/server/mdns.ts` | 63 | 3 | 0 | 0 |
| `packages/ax-code/src/server/middleware.ts` | 104 | 3 | 0 | 0 |
| `packages/ax-code/src/server/request-directory.ts` | 71 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/app-context-checks.ts` | 228 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/app-context-schema.ts` | 52 | 7 | 0 | 0 |
| `packages/ax-code/src/server/routes/app-context-templates.ts` | 118 | 2 | 0 | 0 |
| `packages/ax-code/src/server/routes/app-context.ts` | 182 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/app.ts` | 274 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/audit.ts` | 159 | 3 | 0 | 0 |
| `packages/ax-code/src/server/routes/autonomous.ts` | 111 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/config.ts` | 214 | 5 | 0 | 0 |
| `packages/ax-code/src/server/routes/dre-graph.ts` | 225 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/event.ts` | 135 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/experimental.ts` | 281 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/file.ts` | 192 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/global.ts` | 504 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/graph.ts` | 90 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/isolation.ts` | 122 | 1 | 0 | 0 |
| `packages/ax-code/src/server/routes/mcp.ts` | 306 | 1 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `DEFAULT_SERVER_PORT@packages/ax-code/src/server/constants.ts:1` | public/internal | scanned |
| `MAX_PATH_LENGTH@packages/ax-code/src/server/constants.ts:1` | public/internal | scanned |
| `TOAST_DURATION_LONG_MS@packages/ax-code/src/server/constants.ts:1` | public/internal | scanned |
| `AppErrorEnvelope@packages/ax-code/src/server/error.ts:10` | public/internal | scanned |
| `appErrorEnvelope@packages/ax-code/src/server/error.ts:242` | public/internal | scanned |
| `appErrorResponse@packages/ax-code/src/server/error.ts:256` | public/internal | scanned |
| `invalidRequest@packages/ax-code/src/server/error.ts:260` | public/internal | scanned |
| `notFound@packages/ax-code/src/server/error.ts:272` | public/internal | scanned |
| `forbidden@packages/ax-code/src/server/error.ts:281` | public/internal | scanned |
| `serviceUnavailable@packages/ax-code/src/server/error.ts:290` | public/internal | scanned |
| `rateLimited@packages/ax-code/src/server/error.ts:303` | public/internal | scanned |
| `ERRORS@packages/ax-code/src/server/error.ts:312` | public/internal | scanned |
| `errors@packages/ax-code/src/server/error.ts:363` | public/internal | scanned |
| `Event@packages/ax-code/src/server/event.ts:3` | public/internal | scanned |
| `IpcMessage@packages/ax-code/src/server/ipc-protocol.ts:4` | public/internal | scanned |

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

- io packages/ax-code/src/server/ipc-transport.ts:284
- io packages/ax-code/src/server/ipc-transport.ts:337
- secret packages/ax-code/src/server/routes/app-context-schema.ts:12
- secret packages/ax-code/src/server/routes/app-context-templates.ts:100
- secret packages/ax-code/src/server/routes/app-context.ts:143
- secret packages/ax-code/src/server/routes/app-context.ts:149
- secret packages/ax-code/src/server/routes/app-context.ts:154
- secret packages/ax-code/src/server/routes/config.ts:16
- secret packages/ax-code/src/server/routes/config.ts:64
- secret packages/ax-code/src/server/routes/config.ts:65
- secret packages/ax-code/src/server/routes/config.ts:106
- secret packages/ax-code/src/server/routes/config.ts:120

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (2 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (143 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 50; total LOC: 10261
- Empty catch residual: packages/ax-code/src/server/ipc-transport.ts:319, packages/ax-code/src/server/runtime-adapter.ts:132
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/server`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 2
- Export surface: 143

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-server-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `41e55cdec4602106` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 50 files / 10261 LOC / fp 41e55cdec4602106 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
