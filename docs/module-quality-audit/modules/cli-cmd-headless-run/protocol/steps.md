# Protocol Review: cli-cmd-headless-run

- Reviewer: ax-code-glm
- Model: zai-coding-plan/glm-5.2[1m]
- Unit slug: cli-cmd-headless-run
- Baseline commit: 5fefa00cdc847667d3ba3d38509a751498ee4180
- Primary source: `packages/ax-code/src/cli/cmd/headless-run.ts`

## Step 1 Scope and inventory

The unit resolves to a single 272-line file, `packages/ax-code/src/cli/cmd/headless-run.ts`, exporting one yargs `CommandModule` named `HeadlessRunCommand` (line 33). The command surfaces the `headless-run [message..]` subcommand and orchestrates either an in-process server bootstrap or an HTTP attach to a running server. I confirmed the export count (1) and the zero TODO / zero empty-catch markers reconcile with the MODULE-AUDIT inventory table. The module-private helpers `assertInternalUrl` (line 13) and `createInternalFetch` (line 20), plus the `FetchHandler` type alias (line 11), are not part of the public contract — they exist solely to enforce the fetch trust boundary used by the handler.

## Step 2 Boundary and input trust

Every outbound request funnels through `createInternalFetch` (line 20), which builds a fresh `Request` and calls `assertInternalUrl(new URL(request.url))` on each invocation (line 23). `assertInternalUrl` (line 13) rejects any scheme other than http/https and any hostname that is not internal. Attach mode additionally runs `assertLoopbackHttpUrl(args.attach, "--attach URL")` (line 254) and then a second `assertInternalUrl(attachUrl)` (line 256) before any socket is opened. Auth headers come from `buildAttachAuthHeaders(args.password)` (line 257) and are only injected when the header is absent (lines 24-27), so a caller-supplied header wins over the default. I traced `isInternalHostname` through `src/util/internal-url.ts:21` and confirmed its allow-list resolves to loopback plus the synthetic `opentui.internal` / `opencode.internal` names — there is no route by which an arbitrary remote host reaches the handler.

## Step 3 Correctness of the run loop

`runWithBackend` (line 138) builds the runtime, resolves a session id (lines 148-149), then selects one of three command shapes: `session.abort` for command-smoke (line 152), `session.command` for `--command` (line 157), otherwise `session.prompt` (line 168). Exactly one `command` is handed to `runHeadlessSession` (line 217). The `stopWhen` predicate (line 230) returns on `server.connected` for smoke modes and on `isHeadlessSessionIdleEvent` for real sessions. I cross-checked `isHeadlessSessionIdleEvent` in `src/runtime/headless/event.ts:189`: it requires a `session.status` event whose status type is `idle` and whose `sessionID` matches, so a stray status from a different session cannot end the run early. `onRawEvent` (line 226) re-arms the idle timer and captures the first session error via `headlessSessionErrorMessage`.

## Step 4 Idle timer and signal lifecycle

The inactivity timer is built in `armIdleTimer` (line 192): each event clears and reschedules, the callback sets `timedOut = true` and aborts (lines 197-198), and `idleTimer.unref?.()` (line 200) stops the timer from pinning the event loop. After `runHeadlessSession` resolves, the timer is cleared (lines 235-238) before the `timedOut` check (line 239) — the exact ordering pinned by `test/cli/run-lifecycle.test.ts:97`. SIGINT/SIGTERM are registered with `process.on` (lines 214-215) and removed in the `finally` (lines 248-249); the test at `run-lifecycle.test.ts:109` explicitly asserts `.once` is not used and `.off` is, matching the source. The `finally` also defensively re-clears the timer.

## Step 5 Exit-code semantics

Three terminal states are distinguished: idle timeout sets `process.exitCode = 124` (line 242), a captured session error sets `process.exitCode = 1` (line 244), and a clean idle leaves the code unset. Because the `if (timedOut) ... else if (sessionError)` chain (lines 239-245) is mutually exclusive, a session that errors while also timing out reports 124 rather than 1. That is defensible — the abort is the proximate cause an operator cares about — and the stderr message at line 241 names the wait target (`server.connected` vs `session idle`). The message interpolates `idleTimeoutMs`, a validated finite number (line 183), so there is no injection surface.

## Step 6 Directory and cwd handling

`callerCwd` is captured once (line 117). For attach mode `directory` resolves to `args.dir` verbatim (line 119), which may be `undefined` and is then passed as `directory: undefined` to `createHeadlessAgentRuntime` — harmless because the runtime treats absence as "no directory header". For local mode with `--dir`, `process.chdir(next)` mutates global cwd (line 122) and is never restored, unlike `src/cli/cmd/run.ts`, which (per `run-lifecycle.test.ts:45-51`) restores `previousCwd`. Because `headless-run` is a terminal command that exits immediately after the run, the leaked cwd has no downstream consumer, so the impact is LOW — but the inconsistency with `run.ts` is worth a comment.

## Step 7 stdin and message composition

When stdin is not a TTY (line 127) the stream is buffered via `Buffer.concat` (line 132) and appended with a leading `\n`. If no positional message is supplied, the resulting prompt text is `"\n" + stdin`, carrying a leading newline into `body.parts[0].text` (line 175). The validation guard at line 134 trims before checking emptiness, so an all-whitespace pipe still throws the "requires a message" error — but a non-empty pipe ships the leading newline to the model. This is cosmetic (LOW); trimming `message` before building the part would normalize it. Memory-wise, the unbounded `Buffer.concat` is acceptable for a CLI, though an adversarially large pipe could grow resident memory until the run completes.

## Step 8 Findings register

No Critical or High issues. Candidate observations, all LOW/MEDIUM and none blocking sign-off:

- MEDIUM — coverage for this command (`test/cli/run-lifecycle.test.ts:97-138`) is source-text grep based: the suite reads `headless-run.ts` as a string and asserts substrings rather than executing the handler. A cosmetic refactor (renaming `idleTimer` or reordering the clearTimeout/timeout-check) breaks the suite without changing behavior, and conversely a regression that preserves the pinned substrings would pass. Behavioral coverage would require a fetch/server double; the current guard is pragmatic but brittle.
- LOW — `process.chdir` in local `--dir` mode is not restored, diverging from `run.ts`'s restore pattern (Step 6).
- LOW — piped stdin prepends a `\n` to the prompt text; trimming before `parts[0].text` would clean this (Step 7).
- INFO — `--event-log -` (line 208) is silently treated as "no file sink"; the option describe (line 89) does not document the `-` sentinel.

## Step 9 Verification and exit

I re-read the four collaborators the handler lazy-imports and calls — `src/runtime/headless/runner.ts` (`runHeadlessSession`), `src/runtime/headless/runtime.ts` (`createHeadlessAgentRuntime`), `src/runtime/headless/event.ts` (idle/error predicates), and `src/cli/attach-auth.ts` (`buildAttachAuthHeaders`) — and confirmed the contracts the command relies on hold up: the runner closes the event sink and detaches its abort listener in its own `finally` (runner.ts:126-131), the runtime's `send`/`subscribe` consume exactly the fetch and headers we pass (runtime.ts:42-47), and the auth helper returns `undefined` when no password is configured (attach-auth.ts:4-5) so no spurious `Authorization` header is added in local mode. Static inventory reconciles with MODULE-AUDIT (1 file, 1 export, 0 empty catches, 0 TODOs). No Critical findings were identified, so no `reverify.md` is required for this unit. Recommended disposition: ACCEPT with the LOW/MEDIUM notes above tracked for a follow-up hygiene pass.
