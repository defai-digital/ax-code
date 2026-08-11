# Protocol Steps — cli-cmd-acp

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Unit: `cli-cmd-acp` — resolved root `packages/ax-code/src/cli/cmd/acp.ts` (99 LOC, 1 export).
Independent verifier: codex-sol.

## Step 1 Scope and Map

The unit is a single-file yargs command module at `packages/ax-code/src/cli/cmd/acp.ts:9`
exporting `AcpCommand`. It is registered in `packages/ax-code/src/cli/boot.ts:61`
inside the top-level `cmds` array alongside ~50 sibling commands. Static imports are
limited to `Log`, `bootstrap`, `cmd`, `withNetworkOptions`/`resolveNetworkOptions`, and
`FeatureFlag` (acp.ts:1-5); the heavy collaborators (`@agentclientprotocol/sdk`,
`@/acp/agent`, `@/server/server`, `@ax-code/sdk/v2`) are loaded lazily inside the
handler (acp.ts:20-23), which keeps `ax-code acp` cold-start cheap when the command is
not selected. The `FeatureFlag` helper at `packages/ax-code/src/util/feature-flags.ts:1-5`
just writes `process.env`, so line 24 (`FeatureFlag.set("AX_CODE_CLIENT", "acp")`) is an
env flag, not a persistent setting.

## Step 2 Threat and Failure Surface

The command binds a local HTTP server via `Server.listen(opts)` (acp.ts:27) where `opts`
come from `resolveNetworkOptions` in `packages/ax-code/src/cli/network.ts:41-85`. That
resolver hard-rejects non-loopback `--hostname` (network.ts:74-76) and non-loopback CORS
origins (network.ts:77-80), and forces mDNS off (network.ts:71-73), so the ACP server
cannot be exposed off-host by flag misuse. The ACP transport itself is stdio
(`process.stdin`/`process.stdout`, acp.ts:53-74) and is owned by the parent ACP client,
not a network boundary. No file paths, tokens, or env values are logged; the only logged
values are the literal signal name ("SIGINT"/"SIGTERM") and caught error objects
(acp.ts:33-35, 94). No secrets handling concerns surfaced.

## Step 3 Correctness of the Handler Control Flow

Tracing the handler at acp.ts:19-98: `bootstrap(process.cwd(), ...)` wraps the body in
`Instance.provide` + `Instance.dispose` (packages/ax-code/src/cli/bootstrap.ts:4-17),
so disposal runs even on throw. `stopping` (acp.ts:28, 31) correctly guards the
`shutdown` re-entrancy. However, the SIGINT/SIGTERM listeners registered at acp.ts:46-47
are only detached in the `finally` at acp.ts:91-92, which sits _after_ the awaited
`ACP.init` at acp.ts:77. If `ACP.init` (or `Server.listen`, or `createAxCodeClient`)
throws before the `try` at acp.ts:85, the two signal listeners stay registered on
`process` while the bootstrap disposal path unwinds — a latent leak on the early-failure
path. Separately, the `--cwd` yargs option declared at acp.ts:13-17 (with
`default: process.cwd()`) is never read by the handler; line 25 calls
`bootstrap(process.cwd(), ...)` directly, so a user-supplied `--cwd /some/path` is
silently ignored. The downstream promise at acp.ts:86-89 awaits stdin `end`/`error`
which is the intended lifecycle bound for an ACP server.

## Step 4 Stream and Listener Lifecycle

The `WritableStream`/`ReadableStream` pair (acp.ts:53-74) adapts Node stdio into the web
streams shape that `ndJsonStream` expects. `process.stdin` listeners for `data`, `end`,
and `error` are attached inside the `ReadableStream.start` callback (acp.ts:68-72) and
again at acp.ts:87-88 for the outer await. None of these stdin listeners are removed in
the `finally` block (acp.ts:90-96); only the two `process` signal listeners are detached.
Because the `shutdown` callback calls `process.exit(0)` at acp.ts:37, the leak is masked
in the signal path, but on a graceful stdin-EOF exit the listeners remain attached until
the process terminates. `process.stdin.resume()` at acp.ts:84 is what actually begins
consumption after the stream wiring is in place — ordering is correct.

## Step 5 Concurrency and Re-entrancy

`stopping` is a single boolean guard without synchronization, but the Node event loop is
single-threaded and both signals are dispatched on the main thread, so the guard at
acp.ts:31 is sufficient to prevent double-shutdown. `void shutdown("SIGINT")` and
`void shutdown("SIGTERM")` (acp.ts:41, 44) intentionally fire-and-forget the async
shutdown; the only awaitable inside `shutdown` is `server.stop(true).catch(...)` which
already swallows its own rejection (acp.ts:34-36), so the `void` will not produce an
unhandled rejection. No `Promise.all` over shared mutable state, no counter races — the
async surface here is small and well-contained.

## Step 6 Design and Module Boundary

The command is thin by design: parse args → resolve network opts → start Server → wire
ACP transport → wait. It correctly delegates ACP semantics to `ACP.init` / `agent.create`
(acp.ts:77, 80) and HTTP semantics to `Server.listen`/`Server.stop`. The
`createAxCodeClient` wiring at acp.ts:49-51 routes ACP-originated requests back through
the in-process HTTP server, matching the same pattern used by `ServeCommand`. The
`agent.create(conn, { sdk })` callback at acp.ts:80 returns into the
`AgentSideConnection` constructor whose result is intentionally dropped (acp.ts:79-81) —
the connection self-registers its listeners on `stream`, so there is no handle to retain.
This is idiomatic for the `@agentclientprotocol/sdk` constructor shape and is not a leak.

## Step 7 Hygiene and Dead Code

No empty catch blocks, no `// TODO`, no commented-out blocks. The single hygiene defect
is the dead `cwd` option (acp.ts:13-17): declared, defaulted, documented in the yargs
help string, but never dereferenced from `args`. Either the handler should call
`bootstrap(args.cwd, ...)` (to honor the flag) or the option block should be removed (to
stop advertising unsupported behavior). The `let stopping = false` is a `let` by
necessity. Imports are all used. `FeatureFlag.set("AX_CODE_CLIENT", "acp")` (acp.ts:24)
is the only side effect before `bootstrap`, and it intentionally labels this process as
an ACP client for downstream telemetry routing.

## Step 8 Test Coverage Posture

`packages/ax-code/test/cli/acp.test.ts:5-10` is the only test that targets this file. It
reads `src/cli/cmd/acp.ts` as text and asserts the SDK factory is named
`createAxCodeClient` (not the legacy `createOpencodeClient`) — a pure regression guard
for the rename, not a behavior test. The handler's signal-shutdown path, stream wiring,
loopback enforcement, and the dead `--cwd` option have no direct coverage. The broader
ACP behavior surface is covered by `packages/ax-code/test/acp/*.test.ts` (7 files listed
in MODULE-AUDIT §1), but those exercise `@/acp/agent`, not this CLI entrypoint. Coverage
gap is acceptable for a 99-line wiring module but the `--cwd` defect would not be caught
by the existing suite.

## Step 9 Findings, Severity, and Disposition

No Critical or High severity issues. Three accepted findings:

- **MEDIUM — Dead `--cwd` option.** `packages/ax-code/src/cli/cmd/acp.ts:13-17` declares a
  yargs `cwd` option (defaulted to `process.cwd()`) but the handler at acp.ts:25 calls
  `bootstrap(process.cwd(), ...)` and never reads `args.cwd`. A user invoking
  `ax-code acp --cwd /repo` gets the current working directory silently. Fix: either pass
  `args.cwd` into `bootstrap`, or delete the option block.
- **LOW — Signal-listener leak on early-failure path.** acp.ts:46-47 registers SIGINT/
  SIGTERM handlers; the `finally` that detaches them (acp.ts:91-92) only runs if execution
  reaches the `try` at acp.ts:85. A throw from `Server.listen` (acp.ts:27),
  `createAxCodeClient` (acp.ts:49), or `ACP.init` (acp.ts:77) leaks the two listeners
  during the bootstrap unwind. Wrap the body from line 27 in the `try` or move handler
  registration after `ACP.init` succeeds.
- **LOW — stdin listeners never detached.** acp.ts:68-72 and acp.ts:87-88 attach `data`/
  `end`/`error` listeners to `process.stdin`; the `finally` (acp.ts:90-96) does not remove
  them. Masked by `process.exit(0)` on the signal path (acp.ts:37) but observable on the
  graceful stdin-EOF path.

No Critical findings, so no `reverify.md` is required for this unit. Verifier (codex-sol)
can independently re-walk acp.ts:19-98 against the three findings above.
