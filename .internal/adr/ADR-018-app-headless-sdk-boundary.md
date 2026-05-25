# ADR-018: Promote Headless SDK as the Short-Term App Backend Boundary

## Status

Accepted

## Date

2026-05-25

## Deciders

To be filled by team

## Related

- ADR-007: Establish a Headless Agent Runtime Boundary
- ADR-008: Define Server Operation Mode Boundaries
- ADR-009: Harden Package Organization Boundaries Before Splitting Packages
- `.internal/prd/PRD-2026-05-25-app-headless-sdk-foundation.md`
- `packages/ax-code/src/runtime/headless/`
- `packages/sdk/js`

## Context

The next product direction is an external app repository that uses AX Code as its agent backend. The app should provide the UI and product workflow, while AX Code should provide the local agent runtime, session engine, tool execution, permissions, provider configuration, MCP/LSP behavior, storage, and event stream.

There are three possible near-term integration choices:

1. Drive AX Code through CLI commands such as `headless-run`.
2. Embed the in-process programmatic SDK directly inside the app.
3. Run AX Code as a local headless backend process and consume it through a typed SDK.

There is also a proposed longer-term structural option: split the repository into `ax-code` and a reusable `ax-agent-core` package/repo, then have the new app consume `ax-agent-core` directly.

ADR-007 already established a shared headless runtime boundary but explicitly kept SDK-facing headless APIs out of the initial scope. ADR-008 states that server/headless operation should remain local and controlled, not raw public remote control. ADR-009 says package boundaries should be hardened before broad package splitting.

## Decision

For the short term, promote a first-class App-oriented headless SDK boundary and do not split `ax-agent-core` yet.

The new app should use a process-isolated local AX Code backend by default:

- The app starts or attaches to a local `ax-code` backend process.
- The backend binds to loopback by default, preferably on an auto-selected port.
- The app authenticates with a generated per-run token/password.
- The app communicates through typed SDK APIs over HTTP/SSE.
- The app builds UI state from a shared headless projection reducer.

The CLI `headless-run` remains a hidden smoke/debug adapter. It is not the product API for the app.

The in-process `createAgent()` SDK remains supported for Node.js automation, plugins, tests, and low-overhead embedding. It is not the default backend boundary for the external app because it lacks process isolation.

An `ax-agent-core` extraction remains a possible future outcome, but it should begin as an evidence-based internal package extraction only after the headless app contract stabilizes.

## Policy

### Public Integration Boundary

- Add a public SDK entry point for app/headless integration, such as `@ax-code/sdk/headless`.
- The entry point should expose typed commands, event subscription, projection helpers, and backend lifecycle primitives.
- The SDK must not require consumers to parse CLI text output.
- The SDK must not require consumers to import from `packages/ax-code/src/**`.

### Backend Process Boundary

- The app-oriented backend should be a separate process from the UI by default.
- Backend startup must support random port allocation, readiness detection, generated auth, structured logs, and reliable shutdown.
- The process boundary is required for crash isolation, restart, log capture, and future cross-language app shells.

### Event and Projection Boundary

- Headless event types must be complete, versioned, and regression-tested.
- Error events must be part of the typed contract and projection state.
- Permission, question, diff, todo, tool, session, message, part, VCS, MCP, LSP, and code-index events must be treated as UI-facing product state.
- Autonomous auto-reply behavior must be opt-in for app integrations. GUI apps should default to supervised permission/question UX.

### Package Split Boundary

- Do not create a separate `ax-agent-core` repo as the first step.
- Do not move large runtime subsystems into a new package until import boundaries, tests, and API ownership are clear.
- If extraction becomes justified, start inside the monorepo with a narrow package and stable exports before considering a separate repository.

## Consequences

### Positive

- Gives the external app a stable contract without forcing a risky repository split.
- Preserves process isolation between UI and agent runtime.
- Reuses the existing server, session, tool, provider, permission, MCP, LSP, and storage behavior.
- Makes app state deterministic by centralizing event projection.
- Keeps CLI, TUI, SDK, and app integrations aligned around the same headless runtime contract.

### Negative / Costs

- Requires SDK/API work before the external app can treat AX Code as a stable backend.
- Adds another supported SDK entry point that must be documented and tested.
- Requires lifecycle management beyond the current convenience `createAxCodeServer()` helper.
- Some existing internal headless types may need cleanup before they are safe to publish.
- Defers the cleaner long-term `ax-agent-core` shape.

## Alternatives Considered

### Use `headless-run` as the App Backend

Rejected for product integration. It is useful for smoke tests, JSONL artifacts, and debugging, but it is still a CLI adapter. App code should not depend on CLI stdout semantics, hidden flags, or process text parsing.

### Embed `createAgent()` Directly in the App

Rejected as the default app backend boundary. It is good for Node.js automation and low-latency local scripts, but an app UI benefits from process isolation, independent restart, backend logs, and a language-neutral transport.

### Split `ax-agent-core` Immediately

Rejected for the short term. The core runtime still crosses session, server, storage, auth, providers, tools, permissions, MCP, LSP, and bootstrap behavior. Splitting now would front-load package churn before the app-facing contract is stable.

### Build the New App Against Raw OpenAPI Only

Rejected as incomplete. Generated OpenAPI clients are useful, but app UX needs a higher-level event/projection contract, backend lifecycle helpers, permission/question UX helpers, and typed command wrappers.

## Implementation Tracking

Implementation is tracked in `.internal/prd/PRD-2026-05-25-app-headless-sdk-foundation.md`.

High-level phases:

1. Headless contract audit and event schema cleanup.
2. Public `@ax-code/sdk/headless` entry point.
3. App backend lifecycle manager.
4. Documentation and examples for external app usage.
5. External app smoke harness against the public SDK.

## Non-Decisions

This ADR does not design the external app UI.

This ADR does not create `ax-agent-core`.

This ADR does not make raw `ax-code serve` safe for public internet exposure.

This ADR does not replace the existing in-process programmatic SDK.

This ADR does not choose the long-term managed remote-control architecture.

## Acceptance Criteria

- A public headless SDK entry point exists and is documented.
- The app can start a local backend on loopback with generated auth and subscribe to typed events.
- Event schema tests cover app-visible success, idle, error, permission, question, diff, todo, and message updates.
- The hidden `headless-run` command remains a smoke/debug tool, not the recommended app integration API.
- No separate `ax-agent-core` repository is required for the short-term app integration.
