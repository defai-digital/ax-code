# PRD: App Headless SDK Foundation

**Date:** 2026-05-25
**Status:** Implemented - app headless SDK foundation complete
**Scope:** Internal
**Owner:** ax-code maintainers
**Related:** ADR-018 (App headless SDK boundary), ADR-007 (headless runtime boundary), ADR-008 (server operation mode boundaries), ADR-009 (package organization boundary hardening)
**Archive criteria:** The external app can use a documented public headless SDK to start/attach to a local AX Code backend, stream typed events, drive supervised permission/question UX, and shut down cleanly without depending on CLI text output.

---

## Purpose

Create the short-term AX Code backend foundation for an external app repository.

The app should own UI and product workflow. AX Code should remain the local agent runtime. The integration boundary should be a product-grade headless SDK over a process-isolated local backend, not a CLI wrapper and not an immediate `ax-agent-core` repo split.

## Problem

AX Code already has most backend primitives needed by an app:

- `ax-code serve` and generated HTTP clients;
- SSE event subscription;
- headless commands and projection;
- session, message, permission, question, diff, todo, MCP, LSP, and code-index events;
- programmatic in-process SDK for Node.js automation.

The gap is productization:

- The current headless runtime is mostly internal.
- `headless-run` is hidden and CLI-shaped.
- The SDK has separate in-process and HTTP entry points, but not an app-focused headless entry point.
- Backend lifecycle management is not robust enough for a UI app.
- Event schema and projection need app-grade completeness, especially error handling.
- Permission/question UX must be supervised by default.
- A premature `ax-agent-core` split would create large package churn before the external app contract is proven.

## Goals

1. Provide a public headless SDK entry point for external app integration.
2. Keep the app/backend boundary process-isolated by default.
3. Expose a typed event stream and projection reducer that app UI can consume directly.
4. Make permission and question flows first-class supervised UI state.
5. Provide reliable local backend startup, readiness, auth, logs, and shutdown.
6. Keep CLI `headless-run` as a smoke/debug adapter only.
7. Avoid creating a separate `ax-agent-core` repository in the short term.

## Non-Goals

- Build the external app UI in this repository.
- Split `packages/ax-code` into `ax-agent-core` now.
- Replace the in-process `createAgent()` SDK.
- Build managed remote-control or cloud control-plane features.
- Make raw public network exposure of `ax-code serve` a supported default.
- Rewrite the session engine or server routing layer.

## Target Users

### App developer

As an app developer, I can install a public SDK, start or attach to a local AX Code backend, send prompts/commands, subscribe to events, render state, answer permissions/questions, and shut down cleanly.

### AX Code maintainer

As a maintainer, I can evolve the app backend contract with versioned types, tests, and examples instead of relying on hidden CLI behavior.

### Power user

As a user, I can run an app that uses AX Code locally without exposing my machine to the network or losing the existing permission/sandbox safeguards.

## Requirements

### R1: Public Headless SDK Entry Point

Add a supported SDK entry point, proposed as `@ax-code/sdk/headless`.

It should expose:

- `createHeadlessClient({ baseUrl, directory, headers, fetch })`;
- `startHeadlessBackend({ directory, port, hostname, auth, config, signal })`;
- typed command helpers for prompt, command, shell, abort, permission reply, and question reply;
- typed event subscription as an `AsyncIterable`;
- projection state and reducer helpers;
- SDK/runtime version compatibility checks.

### R2: Backend Lifecycle Manager

The SDK should provide app-grade local backend lifecycle management.

Required behavior:

- loopback bind by default;
- random port support;
- generated per-run auth by default;
- readiness detection that does not rely on brittle text parsing alone;
- structured stdout/stderr log capture hooks;
- reliable shutdown and process-tree cleanup;
- abort signal support;
- clear startup failure errors with captured logs.

### R3: Typed Event Contract

The app-visible event schema must be complete and tested.

Minimum event families:

- server connected/heartbeat/disposed;
- session created/updated/deleted/status/error;
- message updated/removed;
- message part updated/delta/removed;
- permission asked/replied;
- question asked/replied/rejected;
- todo updated;
- session diff;
- session goal;
- VCS branch;
- MCP tools changed;
- LSP updated;
- code index progress/state.

The event contract should include a schema version or compatibility marker before being documented as app-facing.

### R4: Projection Contract

The projection reducer should be safe to use as the default app UI state source.

Required behavior:

- state for sessions, messages, parts, permissions, questions, diffs, todos, status, errors, goals, and runtime probes;
- deterministic handling of out-of-order updates where possible;
- bounded message/part retention defaults;
- no side effects inside the reducer;
- separate effect output for runtime probes or optional autonomous replies.

### R5: Supervised Permission and Question UX

App integrations must default to supervised handling.

Required behavior:

- permission/question events remain pending in projection state until answered;
- autonomous auto-reply is opt-in;
- helpers exist to accept/reject/respond to permission and question requests;
- docs describe required UI states for pending requests.

### R6: Documentation and Examples

Add documentation that clearly routes users across:

- CLI/TUI interactive use;
- in-process `@ax-code/sdk` automation;
- HTTP/OpenAPI generated clients;
- app-oriented `@ax-code/sdk/headless`.

Examples should default to loopback/local mode and avoid implying raw public remote exposure is safe.

### R7: Compatibility With Existing Surfaces

The implementation must not break:

- `@ax-code/sdk` top-level in-process `createAgent()`;
- `@ax-code/sdk/http`;
- generated OpenAPI clients;
- `ax-code serve`;
- TUI sync behavior;
- hidden `headless-run` smoke/debug command.

## Implementation Plan

### Phase 0: Contract Audit and Test Targets

**Status:** Implemented on 2026-05-25. The implementation audited the existing headless runtime, SDK exports, server event stream, and TUI projection adapter before publishing the public app boundary.

**Scope**

- Audit `packages/ax-code/src/runtime/headless/*`, `packages/sdk/js`, `packages/ax-code/src/server/routes/event.ts`, and session command routes.
- List current internal types that are safe to export and types that need cleanup.
- Add or update tests around the current headless event/projection behavior before publishing the SDK surface.

**Acceptance Criteria**

- A short implementation note identifies the exact exported API shape.
- Existing headless runtime tests still pass.
- Event/projection test gaps are listed before code movement.

### Phase 1: Event Schema Completeness

**Status:** Implemented on 2026-05-25.

**Scope**

- Add `session.error` to the typed headless event contract.
- Ensure the runtime event type guard accepts all app-visible events.
- Add projection state for session errors.
- Add tests for error events, idle status, permission/question state, message deltas, todo, diff, and cleanup on session delete.

**Acceptance Criteria**

- App-visible error events are typed, accepted by guards, and reflected in projection state.
- `headless-run` no longer needs a separate raw-event-only path to see session errors.
- Targeted headless event/projection tests pass.

### Phase 2: Public Headless SDK Entry Point

**Status:** Implemented on 2026-05-25.

**Scope**

- Add `packages/sdk/js/src/headless.ts` or equivalent package export.
- Export typed client creation, command helpers, event subscription, projection helpers, and compatibility metadata.
- Avoid deep imports from `packages/ax-code/src/**` in consumer-facing SDK code.
- Keep existing `@ax-code/sdk` and `@ax-code/sdk/http` behavior unchanged.

**Acceptance Criteria**

- `import { createHeadlessClient } from "@ax-code/sdk/headless"` works in a local example/test.
- TypeScript declarations expose only intended public types.
- SDK README routes app developers to the headless entry point.

### Phase 3: App Backend Lifecycle Manager

**Status:** Implemented on 2026-05-25. `startHeadlessBackend()` uses loopback default, random-port default, generated Basic Auth, startup timeout, captured output, abort support, stdout URL discovery followed by `/global/health` readiness verification, and process-group/tree shutdown with SIGTERM/SIGKILL fallback.

**Scope**

- Add `startHeadlessBackend()` or equivalent helper.
- Support `port: 0`, loopback default, generated auth, readiness, structured log hooks, abort, and close.
- Improve process cleanup beyond a simple `proc.kill()` where supported.
- Preserve `createAxCodeServer()` compatibility or implement the new helper alongside it.

**Acceptance Criteria**

- A test can start a backend on a random local port, create a client, observe `server.connected`, and shut down cleanly.
- Startup failure reports captured backend output.
- Shutdown does not leave an AX Code child process behind in normal cases.

### Phase 4: Documentation and Example App Harness

**Status:** Implemented on 2026-05-25. SDK routing docs now mention `@ax-code/sdk/headless`, document app UI projection states, and include a standalone app-style example.

**Scope**

- Update `packages/sdk/README.md`.
- Update `packages/sdk/js/README.md`.
- Add a minimal headless app integration example under SDK examples or docs.
- Document recommended UI states for permission/question/diff/todo/session status.
- Keep remote/network warnings aligned with ADR-008.

**Acceptance Criteria**

- Docs clearly explain when to use `createAgent()`, `@ax-code/sdk/http`, generated clients, and `@ax-code/sdk/headless`.
- Example uses loopback, generated auth, typed events, and supervised permission handling.
- No docs recommend parsing CLI output for app integration.

### Phase 5: External App Smoke Contract

**Status:** Implemented on 2026-05-25. The SDK test suite includes a public-export-only external app smoke that starts a fake backend, creates a session, sends an async prompt, subscribes to SSE, projects events, and shuts down without a real provider.

**Scope**

- Add a smoke script or test fixture that simulates the external app flow from a clean consumer boundary.
- Start backend, create session, send an async prompt or command smoke, subscribe to events, project state, and close.
- Keep provider/model-dependent behavior optional or mocked when needed.

**Acceptance Criteria**

- Smoke can run without a real provider for transport/session/event coverage.
- The smoke uses only public SDK exports.
- Failures identify whether startup, auth, command send, event subscription, projection, or shutdown failed.

## Proposed Public API Sketch

```ts
import {
  createHeadlessClient,
  createHeadlessProjectionState,
  applyHeadlessProjectionEvent,
  startHeadlessBackend,
} from "@ax-code/sdk/headless"

const backend = await startHeadlessBackend({
  directory: "/path/to/workspace",
  hostname: "127.0.0.1",
  port: 0,
})

try {
  const client = createHeadlessClient({
    baseUrl: backend.url,
    directory: "/path/to/workspace",
    headers: backend.headers,
  })

  const state = createHeadlessProjectionState()
  const session = await client.createSession({ title: "App session" })

  const events = client.subscribe({ signal })
  await client.sendPrompt(session.id, {
    parts: [{ type: "text", text: "Review this project" }],
  })

  for await (const event of events) {
    const result = applyHeadlessProjectionEvent(state, event)
    // App renders state and handles result.effects explicitly.
  }
} finally {
  await backend.close()
}
```

The final API may differ, but it must preserve these properties: process isolation, typed commands, typed events, projection, generated auth, and explicit close.

## Validation Plan

Run from `packages/ax-code` unless noted:

- `bun test test/runtime/headless/event-log.test.ts test/runtime/headless/replay.test.ts test/runtime/headless/runner.test.ts`
- `bun test test/headless-types.test.ts test/headless-lifecycle.test.ts` from `packages/sdk/js`
- `bun run typecheck`
- From repo root: `pnpm run check:structure`

Do not run root `pnpm test`.

## Rollout Plan

1. Ship event/projection correctness first.
2. Ship public SDK exports behind clear docs.
3. Ship lifecycle manager and example app harness.
4. Have the external app repo consume only the public SDK.
5. Revisit `ax-agent-core` extraction only after the app has used the SDK boundary long enough to expose stable core seams.

## Risks and Mitigations

| Risk | Mitigation |
| ---- | ---------- |
| SDK surface becomes too broad | Export a narrow headless entry point and keep low-level generated clients separate. |
| App depends on internal runtime details | Add consumer-boundary smoke tests that import only public SDK exports. |
| Backend process leaks | Add lifecycle tests for abort, startup failure, and close paths. |
| Permission UX is bypassed | Default app projection to supervised permission/question state; make autonomous behavior explicit opt-in. |
| Network exposure is misunderstood | Keep loopback defaults and docs aligned with ADR-008. |
| Premature package split distracts from app delivery | Defer `ax-agent-core`; use the app SDK boundary as evidence for future extraction. |

## Open Questions

1. Should the headless SDK live under `@ax-code/sdk/headless` or a new package such as `@ax-code/headless`?
2. Should backend generated auth use password-compatible Basic Auth first, or introduce bearer tokens immediately?
3. What event schema versioning format should be used for app-facing compatibility?
4. Should backend lifecycle tests require real process spawn in CI or use a lighter fixture plus one smoke?
5. How much projection state should be generic versus concrete SDK types?

## Done When

- The external app can use a documented public SDK path without importing AX Code internals.
- The app path does not parse CLI output.
- Backend lifecycle is robust enough for local app startup/shutdown.
- Typed event/projection coverage includes errors, permissions, questions, messages, diffs, todos, and session lifecycle.
- Documentation clearly recommends this path for external app UI integration.
