# Nine-step review protocol: graph

## Step 1 Scope and public contract

The `graph` unit is the two-file scope declared at `docs/module-quality-audit/modules/graph/MODULE-AUDIT.md:5-7`. Its core contract is the `ExecutionGraph` namespace at `packages/ax-code/src/graph/index.ts:9`, where node, edge, metadata, graph, and response schemas are defined through `packages/ax-code/src/graph/index.ts:10-91`. Presentation is separated into `GraphFormat` at `packages/ax-code/src/graph/format.ts:135`, which exposes structured topology lines plus textual and SVG renderers. This review followed both source files and the server, snapshot, replay-query, risk, and focused-test call sites listed in the run record.

## Step 2 Inputs and trust boundaries

`ExecutionGraph.build` accepts a typed session ID and optionally preloaded replay rows (`packages/ax-code/src/graph/index.ts:110-117`); absent preloaded rows, it reads the session event log. Legacy payload values are normalized by `finiteNumber`, `stringValue`, and `eventTokens` at `packages/ax-code/src/graph/index.ts:93-108`, reducing malformed-number and malformed-string propagation. Replay-derived labels cross into multiple response formats through the route selector at `packages/ax-code/src/server/routes/graph.ts:64-86`. Mermaid node IDs and labels are constrained by the sanitizers at `packages/ax-code/src/graph/format.ts:49-59`, while SVG text content is XML-escaped at `packages/ax-code/src/graph/format.ts:478-484`; these are the relevant injection boundaries, and no credential, environment, or process-launch surface is present in this unit.

## Step 3 Graph construction correctness

The empty-session branch returns a schema-shaped graph with zeroed metadata (`packages/ax-code/src/graph/index.ts:118-133`). During the event walk, step starts establish the active step, tool calls enter a pending map, results add `call_result` edges, and recognized nodes receive sequence and containment edges (`packages/ax-code/src/graph/index.ts:149-306`). Remaining calls become pending after the loop at `packages/ax-code/src/graph/index.ts:308-311`; risk and aggregate metadata are attached at `packages/ax-code/src/graph/index.ts:313-329`. The logic assumes replay ordering and non-overlapping step lifetimes; the query supplies ascending sequence order at `packages/ax-code/src/replay/query.ts:116-130`, so that assumption is satisfied for the normal database path.

## Step 4 Edge cases and failure behavior

Malformed legacy numbers become zero and malformed strings become explicit fallbacks rather than invalid Zod values (`packages/ax-code/src/graph/index.ts:93-108`). A result without a matching call remains a result node without a `call_result` edge (`packages/ax-code/src/graph/index.ts:220-240`), and an unfinished call is marked pending (`packages/ax-code/src/graph/index.ts:308-311`). Every formatter has a defined empty-data outcome: timeline and topology at `packages/ax-code/src/graph/format.ts:194-195` and `packages/ax-code/src/graph/format.ts:251-252`, ASCII at `packages/ax-code/src/graph/format.ts:309-310`, Mermaid at `packages/ax-code/src/graph/format.ts:348-349`, Gantt at `packages/ax-code/src/graph/format.ts:427-429`, SVG Gantt at `packages/ax-code/src/graph/format.ts:478-485`, and Markdown at `packages/ax-code/src/graph/format.ts:621-622`. No swallowed exception path was found.

## Step 5 Complexity and data access

The builder makes one ordered pass over replay rows and uses maps for step and pending-call lookup (`packages/ax-code/src/graph/index.ts:135-149` and `packages/ax-code/src/graph/index.ts:308-311`). The database query is bounded and warns when the bound is reached (`packages/ax-code/src/replay/query.ts:116-130`). A noteworthy cost remains: after loading events, the builder invokes `Risk.fromSession` at `packages/ax-code/src/graph/index.ts:313`, and that routine reads session events again at `packages/ax-code/src/risk/score.ts:395-397`. Formatting also performs repeated edge filters and node searches in `kids` and `pair` (`packages/ax-code/src/graph/format.ts:67-87`), then calls those helpers per step in several renderers. These are bounded-session performance hotspots rather than evidence of an immediate correctness failure.

## Step 6 Ownership and API integration

Schema and construction ownership stay in `index.ts`, while `format.ts` imports the graph only as a type (`packages/ax-code/src/graph/format.ts:1-2`). The HTTP layer validates the format enum and delegates all representations to the formatter namespace (`packages/ax-code/src/server/routes/graph.ts:60-86`); the session snapshot similarly combines the canonical graph with typed topology lines at `packages/ax-code/src/session/graph.ts:6-23`. This preserves a single graph model for API, CLI, TUI, rollback, and DRE consumers. The structured topology response is Zod-backed at `packages/ax-code/src/graph/format.ts:141-188`, avoiding an untyped parallel contract.

## Step 7 Test evidence and coverage gaps

The focused suite exercises pending-call status, step containment, and token capture at `packages/ax-code/test/graph/execution-graph.test.ts:10-53`; malformed token, numeric, and string legacy fields are covered at `packages/ax-code/test/graph/execution-graph.test.ts:55-171`, including successful parsing through `ExecutionGraph.Graph`. The audit inventory names this suite at `docs/module-quality-audit/modules/graph/MODULE-AUDIT.md:51-66`. The command `AX_TEST_FILES=test/graph/execution-graph.test.ts pnpm exec vitest run` passed all four tests on 2026-08-11. A repository search found no direct tests invoking `GraphFormat.timeline`, `topologyLines`, `ascii`, `mermaid`, `gantt`, `svgGantt`, or `markdown`; formatter escaping and layout therefore remain a concrete coverage gap.

## Step 8 Findings assessment

The module ledger records no accepted findings at `docs/module-quality-audit/modules/graph/MODULE-AUDIT.md:80-84`, and the unit's `findings/` directory contained no files during this pass. Independent source inspection did not establish a Critical defect. The extra risk-query pass and repeated formatter scans from Step 5 are performance observations, while the lack of direct formatter tests from Step 7 is a coverage observation; neither was promoted to a severity-bearing finding without failing behavior or an existing finding record. Because there is no Critical item to confirm, this primary-review run does not create `protocol/reverify.md`.

## Step 9 Verification and exit decision

The runtime-focused verification completed with one test file and four passing tests, covering the graph-building branches cited above. Contract consistency was also checked at the API boundary: topology returns `GraphFormat.TopologyResponse` at `packages/ax-code/src/server/routes/graph.ts:15-37`, and the default graph response is constrained by `ExecutionGraph.Response` at `packages/ax-code/src/server/routes/graph.ts:40-86`. The previous audit still labels dual-agent work pending at `docs/module-quality-audit/modules/graph/MODULE-AUDIT.md:86-98`; the three protocol artifacts produced by this run supply the codex-sol primary-review evidence and name ax-code-glm as the independent verifier. No source code or other audit unit was changed.
