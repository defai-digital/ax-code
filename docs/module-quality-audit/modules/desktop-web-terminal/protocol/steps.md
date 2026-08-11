# 9-Step Review — desktop-web-terminal

Reviewer: ax-code-glm · Model: zai-coding-plan/glm-5.2[1m] · Unit: `desktop-web-terminal`
Scope root: `desktop/packages/web/server/lib/terminal`

## Step 1 Inventory and module boundary

The unit `desktop-web-terminal` is composed of nine files under
`desktop/packages/web/server/lib/terminal/` (~1778 LOC total). The barrel
`desktop/packages/web/server/lib/terminal/index.js:1` performs zero logic — it
re-exports the WebSocket protocol surface from `terminal-ws-protocol.js` twice:
once under the canonical `TERMINAL_WS_*` names (lines 1-13) and again under the
legacy `TERMINAL_INPUT_WS_*` aliases (lines 15-23). This aliasing is intentional:
the same WS path carries both input keystrokes and output stream data, so the
input/stream transports share one frame format. The replay buffer
(`output-replay-buffer.js`), dimension validator (`terminal-dimensions.js`), and
runtime factory (`runtime.js`) round out the implementation; each has a
co-located `.test.js`. The pure helpers are cleanly separated from the
Express/ws/PTY orchestrator in `runtime.js`, which is the only file with side
effects.

## Step 2 Adversarial surface and trust boundaries

The externally reachable surfaces are seven Express routes plus one WS upgrade.
Session identifiers are 24 random bytes hex-encoded
(`runtime.js:619` for create, `runtime.js:887` for restart) — unguessable, which
matters because the WS bind and the `:sessionId` path lookups key off them. The
WS upgrade handler gates on `uiAuthController?.enabled`
(`runtime.js:491-504`): when auth is on it awaits
`uiAuthController.ensureSessionToken` (493) and then `isRequestOriginAllowed`
(499), rejecting with 401/403 respectively before `handleUpgrade`. Secret hygiene
in `sanitizeTerminalEnv` (`runtime.js:238-245`) explicitly deletes
`AX_CODE_SERVER_PASSWORD`, `BASH_ENV`, `ENV`, and `BASH_XTRACEFD` from the
inherited environment before it reaches the spawned shell — this prevents the
desktop server password and shell-injection vectors from leaking into the PTY.
Resource ceilings: `MAX_TERMINAL_SESSIONS = 20` (`runtime.js:235`) returns HTTP
429 on overflow; `TERMINAL_INPUT_WS_MAX_PAYLOAD_BYTES` (64 KiB) caps frame size
on the `WebSocketServer` (`runtime.js:328`); `TERMINAL_IDLE_TIMEOUT` (30 min, 236) plus the 5-minute `idleSweepInterval` (570-587) reap quiet PTYs. One observation worth recording: the
HTTP routes (create/input/resize/restart/force-kill/stream) do not themselves
re-check `uiAuthController` — they assume an upstream middleware has already
authenticated the request, so the auth boundary lives outside this file.

## Step 3 Control-flow correctness

`observeTerminalShellStartup` (`runtime.js:19-65`) is the subtlest piece. It
resolves on either the grace timer (64) or an early `onExit` (63). The non-obvious
correctness property is on the healthy path: after resolving it deliberately
keeps the `onData` listener attached (comment at 40-42, logic at 43-47) and hands
back a `release()` closure (51-56) that snapshots any bytes that arrived between
resolve and the caller wiring the permanent handler, then detaches. Without this,
the shell prompt emitted in that window would be lost. The caller
`spawnTerminalPtyWithFallback` (166-231) threads `releaseStartupObserver` (223)
through, and both create (644) and restart (910) invoke it to seed the replay
buffer before `wireTerminalSession` installs the live handlers — so there is no
output gap. The fallback loop kills a crashed pty (212) and continues to the next
shell candidate; if all fail it throws a descriptive aggregate error (228-230).
On the WS path, a successful `bind` (`b` frame, 383-441) replays buffered chunks
since the remembered cursor (420-440) and persists `replayCursorBySession` per
connection so a re-bind does not re-send. The SSE `dataHandler`
(`runtime.js:739-757`) pauses the shared pty on backpressure and `cleanup`
(714-721) unconditionally resumes if still paused, closing the leak where a
client disconnect mid-backpressure would freeze output for every other client.

## Step 4 Performance and scaling behavior

`appendTerminalOutputReplayChunk` (`output-replay-buffer.js:35-62`) is the hot
path: every pty byte stream passes through it. The ring eviction loop (56-59)
uses `Array.shift()`, which is O(n), but `TERMINAL_OUTPUT_REPLAY_MAX_BYTES` is
64 KiB so the chunk array stays short and the cost is negligible. The oversized
single-chunk trimmer (`output-replay-buffer.js:3-27`) uses
`Array.from(data)` (15) to walk code points — acceptable because pty chunks are
small; the multibyte test (`output-replay-buffer.test.js:59-66`) confirms
`"🙂x"` trimmed to `"x"` without splitting the surrogate pair. On each bind,
`listTerminalOutputReplayChunksSince` (64-70) is a `filter` over a short array,
and `pruneRebindTimestamps` (`terminal-ws-protocol.js:65-66`) filters a list
capped at `MAX_REBINDS_PER_WINDOW` (3). `getTerminalShellCandidates`
(`runtime.js:129-156`) runs `searchPathFor`/`isExecutable` synchronously on
every create/restart; on a slow `PATH` this is event-loop-blocking but fine for a
local desktop server. `sendTerminalOutputWsData` (311-324) sends synchronously
and swallows send errors, so one slow client cannot stall the pty's onData loop.

## Step 5 Cohesion and ownership

`runtime.js` is the one structural concern at 1009 lines: it owns PTY provider
loading (90-111), Windows/Unix shell resolution (113-165), spawn-with-fallback
(166-231), the ws server lifecycle and per-connection state machine (326-481),
the upgrade auth gate (483-520), replay wiring (524-568), the idle reaper
(570-587), and all seven Express routes (589-970). It is a single factory
(`createTerminalRuntime`, 72-89) with a well-defined dependency-injection
surface (`app`, `server`, `fs`, `validateCwd`, `isRequestOriginAllowed`,
`getPtyProvider`, etc.), which keeps it testable via the
`test-helpers/route-harness.js` mock registry. Even so, extracting
`spawnTerminalPtyWithFallback` + shell resolution into a `pty-spawn.js` and the
ws server block into `ws-server.js` would let the connection message handler be
unit-tested in isolation (see Step 7). This is a Low-priority refactor, not a
defect — the current structure is internally consistent and the injection seam is
clean. `observeTerminalShellStartup` is correctly module-level (not inside the
factory) so it has no hidden closure state.

## Step 6 Silent-failure hygiene

`MODULE-AUDIT.md` flags six empty catches in `runtime.js`; my independent read of
each confirms all six are best-effort teardown/telemetry and none masks a
correctness or security defect: `runtime.js:28-29` and `:31-32` dispose the
startup observer's transient listeners during finish — a throw here must not
abort the resolve. `:211-213` calls `ptyProcess.kill()` on a shell already known
to have crashed; failure is expected (ESRCH). `:306-308` sends an error/ack
control frame; if the send throws the socket is dying and the `close` handler
(469-473) performs real cleanup. `:350-352` sends a heartbeat `ping`; failure
again routes to `close`. `:994-996` terminates ws clients during `shutdown()`,
where a double-terminate is harmless. I concur with the deferred Low-severity
finding `AUDIT-desktop-web-terminal-empty-catch` (expiry 2026-09-11). The only
empty catch with real return semantics is `sendTerminalOutputWsData`
(`runtime.js:321` `} catch { return false }`), which is not strictly empty and is
exercised by the break-on-send-failure loop at 434-440.

## Step 7 Test coverage

The pure modules are well covered. `terminal-ws-protocol.test.js` (136 lines,
17 cases) covers tag-prefix enforcement, malformed-JSON rejection, chunk-array
reassembly (59-63), all `normalize*` code paths including `Uint8Array` and
`ArrayBuffer` (72-81), relative/absolute pathname parsing, and the rebind
prune/rate-limit boundary. `output-replay-buffer.test.js` (75 lines, 8 cases)
covers ring eviction under `maxBytes` (40-48), oversized-chunk trimming, and the
multibyte-no-split property. `terminal-dimensions.test.js` (51 lines) covers
defaults, integer/string acceptance, the `requireBoth` resize mode, and a full
rejection matrix (float/blank/zero/negative/over-`MAX_TERMINAL_DIMENSION`).
`runtime.test.js` (258 lines) covers the startup observer's crash-vs-healthy
branches including the `release()` trailing-snapshot behavior (88-117), the
ordering invariant that `stat` is not called before `validateCwd` authorizes the
path (119-149), upgrade-listener removal on shutdown (180-189), and the
kill-failure-logging regression (193-257). Coverage gap: the ws connection
message handler (`runtime.js:331-481`) and the upgrade auth branch (489-516) have
no direct unit test in this module — they are only reachable through a real ws
client. Extracting the message dispatcher (see Step 5) would close this gap.

## Step 8 Findings disposition

`AUDIT-desktop-web-terminal-001` (Medium, silent-error, status verified-fixed):
`killTerminalProcess` (`runtime.js:274-299`) now logs via `console.warn` on both
the process-group signal failure (287) and the `ptyProcess.kill` failure (297).
The regression test at `runtime.test.js:193-257` spawns a pty whose `kill()`
throws, drives `POST /api/terminal/force-kill`, and asserts `killedCount === 1`
plus that the captured warning contains both `"Failed to kill terminal process"`
and `"simulated kill failure"`. I re-read the test and the production lines; the
fix is real and the assertion is specific. `AUDIT-desktop-web-terminal-empty-catch`
(Low, deferred to 2026-09-11): six best-effort sites, dispositioned per-site in
Step 6; none warrants a blocking change. No Critical-severity items exist in
`findings/`, so no independent Critical re-verification pass is required for this
unit.

## Step 9 Verification

I executed the module's own test suite as the verification gate:
`pnpm --dir desktop/packages/web exec vitest run server/lib/terminal/` (the
`web` vitest project, node environment, per `desktop/vitest.config.ts:38-46`).
Result: `Test Files 4 passed (4)` / `Tests 42 passed (42)` (duration ~2.4s). The
terminal files are plain JavaScript, so `tsc --noEmit` (`type-check` script) and
`eslint src/**` do not traverse `server/**` and are not the relevant gate here.
The 42 passing tests cover all four implementation modules including the
`AUDIT-001` behavioral regression. With tests green, the Medium finding verified
and re-confirmed by re-reading, and the Low finding deferred with per-site
rationale, the `desktop-web-terminal` unit is cleared by this reviewer pending
the independent verifier (codex-sol) sign-off recorded in `MODULE-AUDIT.md`.
