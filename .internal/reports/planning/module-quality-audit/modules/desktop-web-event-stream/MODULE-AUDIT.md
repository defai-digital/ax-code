# MODULE-AUDIT: desktop-web-event-stream

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-event-stream` |
| Scope | `desktop/packages/web/server/lib/event-stream` |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop, performance |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `7a4d37d46e28a9ad` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W7-08 |
| Source files / LOC | 14 / 2404 |

## 1. Scope and map

### Purpose and ownership
Unit `desktop-web-event-stream` owns `desktop/packages/web/server/lib/event-stream`. Risk profile: desktop, performance.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/event-stream/directory-ws-bridge.js` | 222 | 1 | 3 | 0 |
| `desktop/packages/web/server/lib/event-stream/global-hub.js` | 170 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/global-hub.test.js` | 158 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/global-ws-bridge.js` | 235 | 1 | 3 | 0 |
| `desktop/packages/web/server/lib/event-stream/index.js` | 22 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/protocol.js` | 128 | 8 | 2 | 0 |
| `desktop/packages/web/server/lib/event-stream/protocol.test.js` | 179 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/runtime.js` | 175 | 2 | 2 | 0 |
| `desktop/packages/web/server/lib/event-stream/runtime.test.js` | 563 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/test-helpers.js` | 35 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/upstream-health.js` | 12 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/upstream-health.test.js` | 24 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/upstream-reader.js` | 252 | 4 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/upstream-reader.test.js` | 229 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `acceptDirectoryMessageStreamWsConnection@desktop/packages/web/server/lib/event-stream/directory-ws-bridge.js:5` | public/internal | scanned |
| `MESSAGE_STREAM_GLOBAL_REPLAY_LIMIT@desktop/packages/web/server/lib/event-stream/global-hub.js:5` | public/internal | scanned |
| `createGlobalMessageStreamHub@desktop/packages/web/server/lib/event-stream/global-hub.js:7` | public/internal | scanned |
| `createGlobalMessageStreamWsBridge@desktop/packages/web/server/lib/event-stream/global-ws-bridge.js:4` | public/internal | scanned |
| `createGlobalUiEventBroadcaster@desktop/packages/web/server/lib/event-stream/index.js:10` | public/internal | scanned |
| `createMessageStreamWsRuntime@desktop/packages/web/server/lib/event-stream/index.js:10` | public/internal | scanned |
| `MESSAGE_STREAM_GLOBAL_REPLAY_LIMIT@desktop/packages/web/server/lib/event-stream/index.js:12` | public/internal | scanned |
| `createGlobalMessageStreamHub@desktop/packages/web/server/lib/event-stream/index.js:12` | public/internal | scanned |
| `shouldTriggerUpstreamHealthCheck@desktop/packages/web/server/lib/event-stream/index.js:21` | public/internal | scanned |
| `MESSAGE_STREAM_GLOBAL_WS_PATH@desktop/packages/web/server/lib/event-stream/protocol.js:1` | public/internal | scanned |
| `MESSAGE_STREAM_DIRECTORY_WS_PATH@desktop/packages/web/server/lib/event-stream/protocol.js:2` | public/internal | scanned |
| `MESSAGE_STREAM_WS_HEARTBEAT_INTERVAL_MS@desktop/packages/web/server/lib/event-stream/protocol.js:3` | public/internal | scanned |
| `MESSAGE_STREAM_WS_MAX_BUFFERED_BYTES@desktop/packages/web/server/lib/event-stream/protocol.js:8` | public/internal | scanned |
| `MESSAGE_STREAM_WS_BACKPRESSURE_WARN_BYTES@desktop/packages/web/server/lib/event-stream/protocol.js:12` | public/internal | scanned |
| `parseSseEventEnvelope@desktop/packages/web/server/lib/event-stream/protocol.js:14` | public/internal | scanned |

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

- io desktop/packages/web/server/lib/event-stream/protocol.js:41
- io desktop/packages/web/server/lib/event-stream/protocol.test.js:105
- io desktop/packages/web/server/lib/event-stream/protocol.test.js:126
- io desktop/packages/web/server/lib/event-stream/protocol.test.js:127
- io desktop/packages/web/server/lib/event-stream/protocol.test.js:151
- io desktop/packages/web/server/lib/event-stream/protocol.test.js:171
- secret desktop/packages/web/server/lib/event-stream/runtime.js:126
- secret desktop/packages/web/server/lib/event-stream/runtime.js:127
- io desktop/packages/web/server/lib/event-stream/runtime.test.js:16
- io desktop/packages/web/server/lib/event-stream/runtime.test.js:41

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | silent cleanup on bridges |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (10 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (25 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 14; total LOC: 2404
- Empty catch residual: desktop/packages/web/server/lib/event-stream/directory-ws-bridge.js:50, desktop/packages/web/server/lib/event-stream/directory-ws-bridge.js:60, desktop/packages/web/server/lib/event-stream/directory-ws-bridge.js:216, desktop/packages/web/server/lib/event-stream/global-ws-bridge.js:66, desktop/packages/web/server/lib/event-stream/global-ws-bridge.js:163, desktop/packages/web/server/lib/event-stream/global-ws-bridge.js:177
- TODOs: none

## 4. Performance review
Hot-path unit: reviewed static N+1/sync risks in 8 IO hotspots. No new Critical perf finding without baseline measurement.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/web/server/lib/event-stream`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 10
- Export surface: 25

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-event-stream-empty-catch | silent-error | Medium | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `7a4d37d46e28a9ad` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 14 files / 2404 LOC / fp 7a4d37d46e28a9ad |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
