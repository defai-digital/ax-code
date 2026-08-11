# Nine-step review protocol: cli-cmd-run

## Step 1 Scope and entry points

The reviewed unit is `cli-cmd-run`, rooted at `packages/ax-code/src/cli/cmd/run.ts`. Its public surface is the defensive formatter at `packages/ax-code/src/cli/cmd/run.ts:95` and the yargs command at `packages/ax-code/src/cli/cmd/run.ts:265`. The command declares message, session, model, attachment, output, replay, and display options through `packages/ax-code/src/cli/cmd/run.ts:268-367`. Structured-output work crosses one direct boundary: imports at `packages/ax-code/src/cli/cmd/run.ts:34` delegate extraction, path resolution, validation, and writing to `packages/ax-code/src/cli/cmd/run-output.ts:32-119`.

## Step 2 Trust boundaries and abuse cases

Local attachments are resolved against the selected project and rejected when lexically outside it at `packages/ax-code/src/cli/cmd/run.ts:398-419`. The containment primitive explicitly does not resolve symlinks at `packages/ax-code/src/util/filesystem.ts:203-212`, so it is a path-policy check rather than a content isolation boundary; in this same-user local CLI context that is a defense-in-depth limitation, not a privilege escalation. Attached servers are restricted to loopback HTTP(S) at `packages/ax-code/src/cli/cmd/run.ts:811-817` and `packages/ax-code/src/runtime/listen-security.ts:34-44`; Basic credentials are added only after that check via `packages/ax-code/src/cli/attach-auth.ts:3-9`. The in-process fetch adapter rejects non-internal hostnames and injects runtime authentication at `packages/ax-code/src/cli/cmd/run.ts:824-831`.

## Step 3 Functional correctness and failure flow

Argument invariants reject an empty request, an unanchored fork/replay, a replay limit without replay, and non-positive/non-integral limits at `packages/ax-code/src/cli/cmd/run.ts:431-449`. Continue mode selects the first root session at `packages/ax-code/src/cli/cmd/run.ts:479-491`; that is the newest because the server documents most-recent ordering at `packages/ax-code/src/server/routes/session-impl.ts:192-197` and storage orders descending by update time at `packages/ax-code/src/session/index.ts:629-638`. The event loop filters parts, errors, status, and permission requests by the active session at `packages/ax-code/src/cli/cmd/run.ts:547-664`, awaits completion before extracting stored final text at `packages/ax-code/src/cli/cmd/run.ts:779-803`, and restores the caller working directory in the outer `finally` at `packages/ax-code/src/cli/cmd/run.ts:835-840`.

## Step 4 Performance and resource behavior

Normal event handling is streaming (`for await` at `packages/ax-code/src/cli/cmd/run.ts:547`) and tool state is rendered once on terminal states at `packages/ax-code/src/cli/cmd/run.ts:569-595`. Two potentially unbounded paths remain: piped stdin is accumulated into a `Buffer[]` before concatenation at `packages/ax-code/src/cli/cmd/run.ts:423-429`, and replay fetches the full message collection before applying `slice` at `packages/ax-code/src/cli/cmd/run.ts:716-720`. These can increase memory for unusually large input or long sessions, though they are user-driven CLI workloads. Structured validation recursively visits objects and arrays at `packages/ax-code/src/cli/cmd/run-output.ts:122-141` and compiles schema patterns at `packages/ax-code/src/cli/cmd/run-output.ts:236-248`; no background timers or detached loop are introduced by this unit.

## Step 5 Design and ownership

`run.ts` owns command parsing, display renderers, session selection, transport creation, event consumption, and cleanup. The renderer dispatch at `packages/ax-code/src/cli/cmd/run.ts:504-529` cleanly contains malformed tool-output failures and falls back without terminating the run. Async-local path display state at `packages/ax-code/src/cli/cmd/run.ts:58` and `packages/ax-code/src/cli/cmd/run.ts:814-823` prevents concurrent display roots from relying only on mutable `cwd`. Output/schema responsibilities have already been separated behind `handleRunStructuredOutput` at `packages/ax-code/src/cli/cmd/run-output.ts:97-114`; the remaining 843-line command is cohesive at the workflow level but has high change coupling across UI and orchestration.

## Step 6 Hygiene and recoverability

The JSON fallback deliberately converts bigint and circular references and returns `Unknown` when serialization itself fails at `packages/ax-code/src/cli/cmd/run.ts:95-111`. Renderer exceptions are logged with message and stack before a generic rendering path at `packages/ax-code/src/cli/cmd/run.ts:521-528`, while event-loop and final-message retrieval failures are also logged at `packages/ax-code/src/cli/cmd/run.ts:779-795`. The sole syntactically empty catch is the failed `cwd` restoration at `packages/ax-code/src/cli/cmd/run.ts:837-839`; it can conceal a cleanup failure and matches the existing Low finding. A focused scan found no TODO/FIXME/HACK markers or direct console calls in `run.ts` or `run-output.ts`, and package typechecking found no unused/type drift.

## Step 7 Test adequacy

Direct output tests cover alias conflicts, final-message selection, strict JSON parsing, schema success/failure, and write ordering at `packages/ax-code/test/cli/run-output.test.ts:14-152`. The run lifecycle suite covers circular fallback data, loop-await ordering, attached display roots, `cwd` restoration, local SDK directory scoping, renderer logging, and structured-output sequencing at `packages/ax-code/test/cli/run-lifecycle.test.ts:6-95`. Much of the lifecycle coverage is source-text assertion rather than executing `RunCommand`, so behavioral gaps remain around permission auto-rejection, stream errors, session continue/fork/replay, agent fallback, and attach authentication. This is a coverage-quality concern, not evidence of a current failure.

## Step 8 Finding reconciliation

`docs/module-quality-audit/modules/cli-cmd-run/findings/AUDIT-cli-cmd-run-empty-catch.md:5-13` records one Low, deferred silent-error issue with expiry `2026-09-11`. Its site table points to `packages/ax-code/src/cli/cmd/run.ts:839` at finding lines 15-19, and a second reading confirms the catch only suppresses failure to restore `previousCwd`; it does not mask the session result or bypass the loopback checks. No Critical item exists in `findings/`, so the conditional `protocol/reverify.md` artifact is not applicable. The memory and test-depth observations from Steps 4 and 7 are documented review risks but do not contradict the sole registered finding.

## Step 9 Verification and exit assessment

`AX_TEST_FILES=test/cli/run-lifecycle.test.ts,test/cli/run-output.test.ts pnpm exec vitest run` was run from `packages/ax-code` and passed 2 files / 29 tests. `pnpm --dir packages/ax-code run typecheck` also passed. These checks exercise the focused cases imported at `packages/ax-code/test/cli/run-output.test.ts:5-12` and the command formatter imported at `packages/ax-code/test/cli/run-lifecycle.test.ts:4`; the latter suite also pins event-loop ordering at `packages/ax-code/test/cli/run-lifecycle.test.ts:20-32`. Review exit is acceptable with the existing Low deferred cleanup finding retained and the identified behavioral-test/resource observations available for future hardening.
