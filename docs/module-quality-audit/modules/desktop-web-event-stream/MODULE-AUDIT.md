# MODULE-AUDIT: desktop-web-event-stream

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-event-stream` |
| Scope | `desktop/packages/web/server/lib/event-stream` |
| Resolved root | `desktop/packages/web/server/lib/event-stream` |
| XL filter | no |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop, performance |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `516cd83c0fe8488d` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 14 / 2404 |
| Inventory ID | W7-08 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/event-stream/directory-ws-bridge.js` | 222 | 1 | 3 | 0 |
| `desktop/packages/web/server/lib/event-stream/global-hub.js` | 170 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/global-hub.test.js` | 158 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/global-ws-bridge.js` | 235 | 1 | 3 | 0 |
| `desktop/packages/web/server/lib/event-stream/index.js` | 22 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/protocol.js` | 128 | 8 | 2 | 0 |
| `desktop/packages/web/server/lib/event-stream/protocol.test.js` | 179 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/runtime.js` | 175 | 2 | 2 | 0 |
| `desktop/packages/web/server/lib/event-stream/runtime.test.js` | 563 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/test-helpers.js` | 35 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/upstream-health.js` | 12 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/upstream-health.test.js` | 24 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/upstream-reader.js` | 252 | 4 | 0 | 0 |
| `desktop/packages/web/server/lib/event-stream/upstream-reader.test.js` | 229 | 0 | 0 | 0 |

### Exports (sample)
- `acceptDirectoryMessageStreamWsConnection@desktop/packages/web/server/lib/event-stream/directory-ws-bridge.js:5`
- `MESSAGE_STREAM_GLOBAL_REPLAY_LIMIT@desktop/packages/web/server/lib/event-stream/global-hub.js:5`
- `createGlobalMessageStreamHub@desktop/packages/web/server/lib/event-stream/global-hub.js:7`
- `createGlobalMessageStreamWsBridge@desktop/packages/web/server/lib/event-stream/global-ws-bridge.js:4`
- `MESSAGE_STREAM_GLOBAL_WS_PATH@desktop/packages/web/server/lib/event-stream/protocol.js:1`
- `MESSAGE_STREAM_DIRECTORY_WS_PATH@desktop/packages/web/server/lib/event-stream/protocol.js:2`
- `MESSAGE_STREAM_WS_HEARTBEAT_INTERVAL_MS@desktop/packages/web/server/lib/event-stream/protocol.js:3`
- `MESSAGE_STREAM_WS_MAX_BUFFERED_BYTES@desktop/packages/web/server/lib/event-stream/protocol.js:8`
- `MESSAGE_STREAM_WS_BACKPRESSURE_WARN_BYTES@desktop/packages/web/server/lib/event-stream/protocol.js:12`
- `parseSseEventEnvelope@desktop/packages/web/server/lib/event-stream/protocol.js:14`
- `sendMessageStreamWsFrame@desktop/packages/web/server/lib/event-stream/protocol.js:67`
- `sendMessageStreamWsEvent@desktop/packages/web/server/lib/event-stream/protocol.js:120`
- `createGlobalUiEventBroadcaster@desktop/packages/web/server/lib/event-stream/runtime.js:15`
- `createMessageStreamWsRuntime@desktop/packages/web/server/lib/event-stream/runtime.js:46`
- `createSseResponse@desktop/packages/web/server/lib/event-stream/test-helpers.js:1`
- `shouldTriggerUpstreamHealthCheck@desktop/packages/web/server/lib/event-stream/upstream-health.js:1`
- `DEFAULT_UPSTREAM_STALL_TIMEOUT_MS@desktop/packages/web/server/lib/event-stream/upstream-reader.js:3`
- `UPSTREAM_STALL_TIMEOUT_CONCURRENT_MS@desktop/packages/web/server/lib/event-stream/upstream-reader.js:4`
- `DEFAULT_UPSTREAM_RECONNECT_DELAY_MS@desktop/packages/web/server/lib/event-stream/upstream-reader.js:5`
- `createUpstreamSseReader@desktop/packages/web/server/lib/event-stream/upstream-reader.js:51`

### Tests
- `packages/ax-code/test/acp/event-subscription.test.ts`
- `packages/ax-code/test/cli/tui/coalesce-stream-events.test.ts`
- `packages/ax-code/test/cli/tui/desktop-handoff.test.ts`
- `packages/ax-code/test/cli/tui/event-source-wire-death.test.ts`
- `packages/ax-code/test/cli/tui/stream-paint.test.ts`
- `packages/ax-code/test/cli/tui/stream-resilience.test.ts`
- `packages/ax-code/test/cli/tui/sync-store-event.test.ts`
- `packages/ax-code/test/cli/tui/worker-event-stream.test.ts`
- `packages/ax-code/test/control-plane/agent-control-events.test.ts`
- `packages/ax-code/test/desktop/webui.test.ts`
- `packages/ax-code/test/replay/agent-control-events.test.ts`
- `packages/ax-code/test/runtime/headless/event-log.test.ts`
- `packages/ax-code/test/runtime/headless/event-sink-node.test.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/tool/webfetch.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (20) | static map |
| Silent failure | empty catch (10) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop,performance | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-event-stream-empty-catch | silent-error | Medium | new | deferred |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `516cd83c0fe8488d` |
| Dual-agent protocol | PENDING |
| Critical independent verify | pending |

### Exit checklist
- [ ] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [ ] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | — | — | protocol pending |
| Independent verifier | — | — | pending |
| Module owner | — | — | REVIEWING |
