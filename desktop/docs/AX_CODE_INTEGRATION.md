# AX Code Integration Decisions

How this app integrates with the upstream AX Code runtime
(github.com/defai-digital/ax-code), which upstream-documented paths it uses,
and what is being tracked for the future.

## Transport choice: SDK headless + HTTP proxy

Upstream's SDK README defines the supported integration surfaces:

| Need                                            | Upstream-recommended path                |
| ----------------------------------------------- | ---------------------------------------- |
| App UI with a local process-isolated AX backend | `@ax-code/sdk/headless`                  |
| First-party desktop/native GUI                  | `@ax-code/sdk/grpc` (proto contract)     |
| TypeScript/JavaScript over raw HTTP             | `@ax-code/sdk/http` with `ax-code serve` |

This app uses the **headless** path: the web server launches the runtime via
`startHeadlessBackend` (`packages/web/server/lib/ax-code/lifecycle.js`) and
proxies its HTTP API to the frontend. On macOS/Linux it passes explicit
`binary` and `args` into the SDK so wrapper launches and custom binary names
still use SDK-owned readiness, auth, diagnostics, and shutdown behavior. On
Windows/WSL it falls back to spawning `ax-code serve` directly, which matches
upstream's documented HTTP contract.

Typed access goes through the generated v2 client: source code imports only
public SDK entry points (`@ax-code/sdk/v2`, `@ax-code/sdk/v2/client`,
`@ax-code/sdk/headless`, `@ax-code/sdk`). Deep `dist/` imports are not
allowed — the contract test in
`packages/web/server/lib/ax-code/sdk-contract.test.js` pins the entry points.

**Tracking — gRPC status (verified 2026-06-10 against SDK 2.2.0 and upstream
`docs/sdk-grpc-native.md`):** `@ax-code/sdk/grpc` is currently an API facade,
not a transport change. `createAxCodeGrpcHttpBridge` implements every method
over `createHeadlessClient` (the same HTTP client), `SubscribeEvents` consumes
the same SSE route, `ConnectPty` uses WebSocket, and every method descriptor
is flagged `httpBridge: true`. The ax-code runtime does not yet serve the
native gRPC wire protocol — upstream describes the HTTP bridge as the interim
"while the native server is being implemented" and calls
`startAxCodeGrpcHeadlessBackend()` a "temporary fallback". Upstream also
states the transport "is not the dominant latency source for normal agent
turns". Conclusion: migrating to the gRPC facade today changes API shape but
not performance. Adopt it (incrementally, as future-proofing) once upstream
ships the native gRPC server, or earlier only if measurements from
`scripts/ax-code-perf-report.mjs` show pipeline overhead actually matters.

## Workspace SDK and compatibility

Two version axes move independently:

- **SDK** (`@ax-code/sdk`): consumed from the monorepo workspace. See
  `docs/AX_CODE_REVENDOR_CHECKLIST.md` for the workspace SDK contract checklist.
- **Runtime/CLI** (`ax-code`): installed by the user, updates independently.
  `packages/web/server/lib/ax-code/version-compat.js` defines
  `MIN_SUPPORTED_AX_CODE_VERSION`; the server reports compatibility through
  `/api/ax-code/upgrade-status` and `/health`, logs a startup warning, and the
  UI raises a persistent toast when the installed runtime is too old.

## Upstream feature requests to file

Remaining workarounds in `lifecycle.js` exist because a few SDK internals are
not exported yet; each should become a core SDK issue so the mirrored code can
be deleted:

1. **Headless handles should expose child-process lifecycle fields.** The
   handle returned by `startHeadlessBackend` lacks `exitCode`/`signalCode`,
   so the app patches them to `null` to keep its liveness checks working.

2. **Export the loopback-hostname guard.** The app mirrors the SDK's private
   `isLoopbackHostname` to decide when to set `allowNetworkBind`; an exported
   helper (or an SDK option that takes precedence) would remove the drift
   risk.
