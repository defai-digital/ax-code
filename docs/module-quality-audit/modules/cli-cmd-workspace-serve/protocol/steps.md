# Protocol — cli-cmd-workspace-serve (9-step)

Reviewer: ax-code-glm · Model: zai-coding-plan/glm-5.2[1m] · Date: 2026-08-11
Verifier lane: codex-sol · Baseline: `5fefa00cdc847667d3ba3d38509a751498ee4180`

The resolved unit root is a one-line barrel:
`packages/ax-code/src/cli/cmd/workspace-serve.ts:1` →
`export { WorkspaceServeCommand } from "./runtime/workspace-serve"`.
The real logic lives in the sibling runtime file, so both were read in full, along
with every transitive dependency the handler touches.

## Step 1 Inventory and module shape

`workspace-serve.ts:1` is a pure re-export; the implementation is
`packages/ax-code/src/cli/cmd/runtime/workspace-serve.ts` (24 lines). The command
is produced by the shared `cmd()` identity helper at
`packages/ax-code/src/cli/cmd/cmd.ts:5`, which just stamps a `CommandModule` and
adds an optional `--` passthrough. The handler pulls four collaborators:
`resolveNetworkOptions`/`requireAuthForNetwork`/`withNetworkOptions` from
`packages/ax-code/src/cli/network.ts`, `WorkspaceServer` from
`packages/ax-code/src/control-plane/workspace-server/server.ts`, and
`registerShutdownSignals` from `packages/ax-code/src/util/signals.ts`. No other
modules in `src/` import `WorkspaceServeCommand` (grep across `*.ts` returns only
the two definition sites), so the unit is a leaf with no internal dependents.

## Step 2 Export contract

`runtime/workspace-serve.ts:6` exports `WorkspaceServeCommand` with
`command: "workspace-serve"`, `describe: "starts a remote workspace event
server"`, `builder: (yargs) => withNetworkOptions(yargs)`, and an `async handler`.
The builder wiring is correct: `network.ts:37` registers `port`, `hostname`,
`mdns`, `mdns-domain`, and `cors` with sane loopback defaults (`network.ts:6-32`),
so the surface matches the sibling `serve` command. The `cmd()` wrapper adds no
behaviour, so the contract is exactly a stock yargs `CommandModule`. No type or
signature defect here.

## Step 3 Handler control flow

Tracing `runtime/workspace-serve.ts:10-23`: (1) `await resolveNetworkOptions(args)`
folds config + argv, rejecting non-loopback `--hostname` and non-loopback `--cors`
(`network.ts:74-80`); (2) `requireAuthForNetwork(opts.hostname)` is a redundant
loopback guard that `process.exit(1)`s on non-loopback binds (`network.ts:91-100`);
(3) `WorkspaceServer.Listen(opts)` normalizes the hostname and calls
`assertAuthenticatedNetworkBind` again (`server.ts:104-110`,
`listen-security.ts:27-32`) — a third loopback check, defence-in-depth; (4) logs
the `/event` URL; (5) `registerShutdownSignals(shutdown)` (`signals.ts:16-34`)
wires SIGINT/SIGTERM/SIGHUP/SIGQUIT to `server.stop()` then `process.exit(0)`;
(6) `await new Promise(() => {})` blocks forever, identical idiom to
`runtime/serve.ts:62`. The flow is internally coherent.

## Step 4 Reachability — wiring defect (finding)

This is the substantive issue. A command module is only live if it is added to a
yargs registry. The primary registry is `packages/ax-code/src/cli/boot.ts` whose
`cmds` array (`boot.ts:60-106`) lists 46 commands including `ServeCommand`
(`boot.ts:84`) but **not** `WorkspaceServeCommand`, and there is no
`import { WorkspaceServeCommand } from "./cmd/workspace-serve"` among the imports
at `boot.ts:4-48`. The secondary registry `boot-node.ts:16` is
`[DoctorCommand, GenerateCommand]` only. There is no plugin auto-discovery and no
dynamic registration (confirmed by `grep workspace-serve|WorkspaceServeCommand`
across `src/**/*.ts` returning only the two definition lines). Net effect:
`ax-code workspace-serve` is not a runnable command; the entire
`runtime/workspace-serve.ts` handler is unreachable as shipped. The underlying
`WorkspaceServer` remains live because it is consumed by tests and (per the
audit map) other surfaces, but **this CLI shim is dead code**. Severity High: no
security or data-loss exposure (the command cannot bind anything because it can
never be invoked), but a whole shipped entry point is silently inert and any user
following documentation or intuition to run `ax-code workspace-serve` gets yargs'
"Unknown argument" failure. Either re-register it in `boot.ts` (one import + one
array entry) or delete both files.

## Step 5 Security posture (conditional on reachability)

Because Step 4 shows the command is unreachable today, there is no live attack
surface from this unit. Were it re-registered, the bind is safe-by-design:
`WorkspaceServer.Listen` (`server.ts:104-110`) calls
`assertAuthenticatedNetworkBind` synchronously and the test at
`test/control-plane/workspace-server-sse.test.ts:19-21` asserts
`WorkspaceServer.Listen({ hostname: "0.0.0.0", port: 0 })` throws `/local-only/`,
so a non-loopback bind cannot succeed. `server.ts:24-29` layers optional
`basicAuth` gated on `Flag.AX_CODE_SERVER_PASSWORD`. No secrets are logged; the
only `console.log` (`runtime/workspace-serve.ts:14`) emits the loopback URL and
port, never credentials or the workspace header. No path traversal, command
injection, or SSRF surface exists in this unit's code.

## Step 6 Resource lifecycle and shutdown

`runtime/workspace-serve.ts:16-20` defines `shutdown` → `await server.stop()` →
`process.exit(0)` and hands it to `registerShutdownSignals`. The
`ServerHandle.stop` contract (`runtime-adapter.ts:23-28`) closes the HTTP server;
on Node it also closes ws clients (`runtime-adapter.ts:127-135`). The single-shot
guard in `signals.ts:18-30` (`handled` flag + swallowed callback errors) prevents
double-shutdown. The `await new Promise(() => {})` at line 22 keeps the process
alive correctly. Compared to `runtime/serve.ts:55-60`, this command omits IPC
teardown — but it has no IPC socket, so that is correct, not a leak. The only
soft edge: `registerShutdownSignals`'s catch swallows errors from `server.stop()`
(`signals.ts:27-29`), so a failure to close the HTTP server would exit silently
rather than surface; acceptable for a CLI but worth a Low note.

## Step 7 Design and consistency

The structure deliberately mirrors `runtime/serve.ts` (resolve → requireAuth →
listen → log → signals → block). That parallelism is good for maintainability.
Two minor divergences: (a) the log line at `runtime/workspace-serve.ts:14` prints
`http://${hostname}:${port}/event` while `serve.ts:52` prints without the path —
cosmetic, both are loopback so safe; (b) `requireAuthForNetwork`'s error text at
`network.ts:93-98` says "Bind to localhost only ... `ax-code serve`", naming the
sibling command rather than `workspace-serve`. Because the helper is shared this
is a generic message, but a user hitting it via this command would see a
misleading suggestion. Out of strict scope for this unit but flagged Low since
this command's only realistic failure path surfaces it.

## Step 8 Tests

`packages/ax-code/test/control-plane/workspace-server-sse.test.ts` exercises
`WorkspaceServer.Listen`/`App()` directly (loopback rejection at line 19-21,
missing-header 400 at 23-31, header acceptance at 33+, SSE behaviour through line
179). It does **not** import `WorkspaceServeCommand` and does not exercise the
yargs handler, the builder, or the shutdown wiring. No test in the package
references `workspace-serve` (grep across `*.test.ts` returns only the server
file). Consequently the registration defect from Step 4 has no test guard: a
registry test asserting `boot.ts` `cmds` contains every exported `*Command` would
have caught this. This is the structural reason the dead code survived.

## Step 9 Verification and exit

Typecheck scope for this unit is the `cmd/runtime/workspace-serve.ts` import
graph, which compiles cleanly against `network.ts`, `server.ts`, `signals.ts`,
and `cmd.ts`. No runtime verification of the command is possible because it is
not registered (Step 4). Disposition: one High finding (unreachable command /
dead wiring) with two Low cosmetic notes (shared error message naming, swallowed
`stop()` errors). No Critical, no security exposure, no data-loss path. The
remediation is binary and cheap — either add the command to `boot.ts` `cmds[]`
or delete `workspace-serve.ts` and `runtime/workspace-serve.ts` together; either
resolution should land with a registry-coverage test so this class of wiring gap
is caught next time.
