# Review Protocol — cli-cmd-graph

Reviewer: `codex-sol` (`gpt-5.6-sol-xhigh`)  
Independent verifier: `ax-code-glm`

This review follows the command from `/Users/akiralam/code/ax-code/packages/ax-code/src/cli/cmd/graph.ts` into session lookup, replay queries, graph construction, formatting, CLI registration, and the nearest tests.

## Step 1 Scope and command registration

The unit exports one yargs descriptor, `GraphCommand`, at `packages/ax-code/src/cli/cmd/graph.ts:9`. Its public syntax is `graph [sessionID]` (`graph.ts:10`), with one optional positional and the `--format` and `--json` options (`graph.ts:14-27). The command is live rather than orphaned: `packages/ax-code/src/cli/boot.ts:23` imports it and `boot.ts:92` adds it to the command registry. The existing audit identifies the same resolved root at `docs/module-quality-audit/modules/cli-cmd-graph/MODULE-AUDIT.md:5-7`, but its protocol status is explicitly pending at `MODULE-AUDIT.md:16`; this document supplies the evidence-bearing pass.

## Step 2 Inputs, output boundary, and terminal safety

Yargs limits `--format` to six named values and defaults it to markdown (`packages/ax-code/src/cli/cmd/graph.ts:18-22`); the boolean alias is declared separately at `graph.ts:23-27`. The handler does not spawn a shell, make a network request, or accept a destination path: its external effect is stdout through `console.log` at `graph.ts:42` and `graph.ts:51-71`. Output does contain persisted event-derived text. Tool targets become labels in `packages/ax-code/src/graph/index.ts:202-215`, and error messages become labels at `index.ts:276-285`; markdown emits those labels directly at `packages/ax-code/src/graph/format.ts:669-684`. Therefore local replay data is a trust boundary for terminal output. The command adds no command-injection path, but terminal-control characters in a malicious filename or recorded error are not neutralized on the ascii, markdown, timeline, or topology paths. This is a Low hardening advisory because the data is local and user-requested, not a remote response rendered automatically.

## Step 3 Session selection and empty-session correctness

The handler establishes the current working directory as the instance scope (`packages/ax-code/src/cli/cmd/graph.ts:29-31`) and delegates selection at `graph.ts:33`. An explicit ID reaches `Session.get` through `packages/ax-code/src/cli/cmd/session-latest.ts:5-6`; that lookup throws `NotFoundError` when no row exists (`packages/ax-code/src/session/index.ts:468-473`). With no ID, the newest listed session is selected (`session-latest.ts:8`), and the undefined case prints the shared guidance (`session-latest.ts:11-13`; `graph.ts:34-37`).

There is one Medium output-contract defect. `graph.ts:40-44` exits with plain text whenever the selected session has zero events, before examining the requested format at `graph.ts:47`. Consequently `ax-code graph --json` succeeds while producing `No events for session ...`, which is not JSON. The downstream APIs already define the correct empty representation: `ExecutionGraph.build` returns an empty typed graph at `packages/ax-code/src/graph/index.ts:117-132`, and `GraphFormat.json` serializes any graph at `packages/ax-code/src/graph/format.ts:190-192`. Building and dispatching the empty graph would preserve every selected format.

## Step 4 Non-empty format dispatch

For sessions with events, `--json` intentionally takes precedence over `--format` at `packages/ax-code/src/cli/cmd/graph.ts:47`. Every builder choice has a matching switch arm: ascii joins lines (`graph.ts:50-52`), JSON prints the serialized graph (`graph.ts:53-55`), Mermaid prints one document (`graph.ts:56-58`), timeline projects structured entries to their text fields (`graph.ts:59-65`), topology joins its lines (`graph.ts:66-68`), and markdown is both an explicit case and the defensive fallback (`graph.ts:69-72`). The newline handling matches the formatter contracts: `GraphFormat.timeline` returns `TimelineLine[]` (`packages/ax-code/src/graph/format.ts:194-249`), `topology` returns `string[]` (`format.ts:305-307`), while `markdown` returns a single string (`format.ts:621-697`). No fallthrough or missing non-empty format branch was found.

## Step 5 Query cost and large-session behavior

The empty check uses a database `COUNT(*)` rather than materializing rows (`packages/ax-code/src/replay/query.ts:227-238`), then `ExecutionGraph.build` performs a second ordered row query through `bySessionWithTimestamp` (`packages/ax-code/src/graph/index.ts:110-117`; `packages/ax-code/src/replay/query.ts:116-130`). This adds one cheap round trip to every non-empty invocation; removing the preflight as proposed in Step 3 would also remove that duplication. The graph load is capped at 10,000 rows (`query.ts:13-20`, `:123-129`). If the cap is exceeded, the query writes a truncation warning through its logger (`query.ts:37-47`) but the CLI still prints a partial graph without an stdout marker. That is a non-blocking completeness advisory for unusually long diagnostic sessions; the bounded load appropriately prevents unbounded memory growth.

## Step 6 Layering and ownership

The command is thin orchestration: project context belongs to `Instance.provide` (`packages/ax-code/src/cli/cmd/graph.ts:29-31`), session choice belongs to `session-latest.ts:4-13`, graph derivation belongs to `ExecutionGraph.build` (`graph.ts:46`), and representation belongs to `GraphFormat` (`graph.ts:49-72`). This direction matches the repository architecture, which places CLI surfaces and repository-graph functionality in separate core subsystems (`AGENTS.md:58-71`). The same formatter functions are used by the HTTP graph route, for example ascii/mermaid/markdown/timeline/topology at `packages/ax-code/src/server/routes/graph.ts:74-85`, reducing semantic drift across interfaces. The CLI exposes a deliberate subset of the server's additional gantt formats; no duplicated graph-building logic exists in the reviewed command.

## Step 7 Code hygiene and maintainability

All seven imports in `packages/ax-code/src/cli/cmd/graph.ts:1-7` are used, `GraphCommand` is the only export (`graph.ts:9`), and the file contains no catch blocks, suppression comments, TODO/FIXME markers, or unreachable cases. The local `let sessionID: SessionID` at `graph.ts:32` followed by a single assignment at `graph.ts:38` can be simplified to `const sessionID = session.id`, but it has no behavioral impact. The cast of `args.format` to `string` at `graph.ts:47` weakens compile-time exhaustiveness, although yargs choices at `graph.ts:20` constrain real CLI input and the default arm remains safe. These are readability observations, not accepted defects.

## Step 8 Behavioral coverage

The underlying builder has four focused tests in `packages/ax-code/test/graph/execution-graph.test.ts:10-171`: pending calls and step containment are asserted at `:38-48`, malformed token values at `:82-88`, malformed numeric values at `:121-124`, and malformed strings at `:163-166`. The focused run passed all four tests. Coverage stops below the unit boundary: repository search found no test importing `GraphCommand` or exercising its six output branches. The nearest smoke test is misleadingly titled “session graph commands,” but its table contains only rollback, compare, and branch (`packages/ax-code/test/cli/smoke.test.ts:268-286`), not `graph`. Thus the zero-event JSON violation, `--json` precedence, default markdown behavior, and formatter joining are unpinned. A direct CLI test creating a session with no replay events and parsing `graph --json` should be the first regression case.

## Step 9 Findings and verification outcome

This primary review accepts one Medium finding: zero-event sessions ignore the selected output format and make `--json` emit non-JSON text (`packages/ax-code/src/cli/cmd/graph.ts:40-47`). It also records two Low advisories: recorded labels can carry terminal-control characters into text formats (`packages/ax-code/src/graph/index.ts:202-215`, `:276-285`; `packages/ax-code/src/graph/format.ts:669-684`), and graphs beyond the replay-query cap are partial without an stdout truncation notice (`packages/ax-code/src/replay/query.ts:13-20`, `:116-130`). The missing command-level tests in Step 8 raise the regression risk but are not a separate runtime defect. Verification ran `AX_TEST_FILES=test/graph/execution-graph.test.ts pnpm exec vitest run` from `packages/ax-code` and passed 1 file / 4 tests. No Critical-severity item exists under this unit's `findings/` directory or arose in this review, so the conditional `protocol/reverify.md` artifact is not required.
