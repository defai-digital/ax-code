# Review protocol — cli-cmd-compare

Reviewer: `codex-sol` (`gpt-5.6-sol-xhigh`)  
Independent verifier: `ax-code-glm`

## Step 1 Scope and command surface

The `cli-cmd-compare` unit is implemented by `packages/ax-code/src/cli/cmd/compare.ts`. Its two exported surfaces are the yargs `CompareCommand` at `packages/ax-code/src/cli/cmd/compare.ts:11` and the event-key helper `compareEventTypes` at `packages/ax-code/src/cli/cmd/compare.ts:169`. The command requires two session IDs and offers boolean `--json` and `--deep` switches (`compare.ts:12-23`). It is part of the production CLI: `packages/ax-code/src/cli/boot.ts:16` imports it and `packages/ax-code/src/cli/boot.ts:74` registers it. This matches the source root in `docs/module-quality-audit/modules/cli-cmd-compare/MODULE-AUDIT.md:5-7`.

## Step 2 Inputs, trust boundaries, and failures

Both positional values enter as arbitrary strings and are converted to branded IDs at `packages/ax-code/src/cli/cmd/compare.ts:28-29`; existence is then checked concurrently at lines 31-34. `getRequiredSession` preserves unexpected storage errors but prints a not-found diagnostic and exits nonzero for the expected case (`packages/ax-code/src/cli/cmd/session-required.ts:5-12`). JSON mode passes stored titles and calculated values through `JSON.stringify` (`compare.ts:41-60`), while human mode writes stored titles and replay reasons directly (`compare.ts:69-75,140-142`). Because those strings are not terminal-sanitized, crafted control characters in persisted metadata could affect a local terminal or captured log; this is a Medium output-hardening concern, not a remote execution path. No shell command, credential, or network request is constructed in this unit.

## Step 3 Comparison correctness

The handler loads both sessions before deriving ordered event arrays and risk assessments (`packages/ax-code/src/cli/cmd/compare.ts:31-39`). Its JSON delta compares tool-call order, route endpoints, and total slice length (`compare.ts:43-55,173-189`); human output additionally reports risk score/level, changed failure/file signals, tool paths, route paths, per-type count changes, and totals (`compare.ts:68-145`). Event rows are ordered by sequence, but `EventQuery.bySession` caps them at 10,000 and only warns when more exist (`packages/ax-code/src/replay/query.ts:13-26,67-79`). Thus ordinary compare output can state a truncated event total and derive a partial tool/route delta. Deep mode does fail loudly because `Replay.compare` uses `bySessionStrict` (`packages/ax-code/src/replay/replay.ts:342-346`), but the already loaded ordinary summaries are not themselves strict. Partial non-deep output is a Medium correctness concern for very long sessions.

## Step 4 Complexity and resource use

Session metadata fetches are parallelized with `Promise.all` at `packages/ax-code/src/cli/cmd/compare.ts:31-34`, and the local extraction/counting helpers are linear in the bounded event slices (`compare.ts:151-170,173-189`). Peak command memory is therefore bounded by two 10,000-event arrays plus derived strings and maps. There is repeated storage work: the command loads each event log at `compare.ts:35`, then `Risk.fromSession` loads it again (`packages/ax-code/src/risk/score.ts:395-410`), and deep mode performs a third strict load per session (`packages/ax-code/src/replay/replay.ts:342-346`). The repetition is a Low performance concern, especially when events contain large tool results, although the query cap prevents an unbounded read.

## Step 5 Ownership and dependency design

The module correctly delegates project lifecycle to `Instance`, session lookup to `getRequiredSession`, risk calculation to `Risk`, and deterministic replay checks to `Replay` (`packages/ax-code/src/cli/cmd/compare.ts:24-39`). However, its private tool/route/count/delta implementation at `compare.ts:151-189` duplicates the domain helpers in `packages/ax-code/src/replay/compare.ts:106-138`. A richer shared comparison assembly also exists in `packages/ax-code/src/session/compare.ts:247-312`, including the same event/risk/deep inputs. Keeping the CLI on a separate calculation path makes API and CLI semantics easier to drift; reusing `ReplayCompare` at minimum would give the delta one owner. This is maintainability debt rather than a present Critical defect.

## Step 6 Type safety and data modeling

The event schema gives `agent.route` concrete `fromAgent`, `toAgent`, and `confidence` fields at `packages/ax-code/src/replay/event.ts:27-35`, and the discriminated union includes that event at lines 296-327. The filter in `packages/ax-code/src/cli/cmd/compare.ts:157-160` already narrows to this variant, so its three `(e as any)` assertions are unnecessary and weaken compile-time protection against schema changes. By contrast, `extractToolChain` uses the narrowed `tool.call` field directly (`compare.ts:151-155`), and `compareEventTypes` delegates stable deduplication/sorting to `uniqueSortedStrings`, whose implementation is explicit at `packages/ax-code/src/util/string-list.ts:6-15`.

## Step 7 Hygiene and maintainability

The 190-line command has no catch block, suppression directive, TODO/FIXME marker, commented-out implementation, or module-level mutable state. The JSON early return at `packages/ax-code/src/cli/cmd/compare.ts:41-62` cleanly separates machine and human output. The non-null assertions for `deep1` and `deep2` at lines 51-52 are justified by the same `args.deep` condition that initializes both at lines 38-39, though constructing the replay object after an explicit guard would be easier to maintain. The exported `compareEventTypes` is small and deterministic, but it is public primarily so the isolated test can reach otherwise internal count-key behavior.

## Step 8 Test evidence and issue register

The only direct unit test imports `compareEventTypes` and verifies a sorted union with a duplicate event key at `packages/ax-code/test/cli/compare.test.ts:1-10`. It does not execute the yargs handler or cover missing sessions, JSON shape, human formatting, route/tool deltas, risk deltas, `--deep`, truncation, or propagated storage failures. The existing register says no item is accepted at `docs/module-quality-audit/modules/cli-cmd-compare/MODULE-AUDIT.md:61-65`, and the unit's `findings/` directory is empty. This pass documents two Medium concerns (terminal control-text handling and partial non-deep results) plus Low repeated-query/design debt. No Critical evidence exists, so no `protocol/reverify.md` is created.

## Step 9 Focused verification and outcome

`AX_TEST_FILES=test/cli/compare.test.ts pnpm --dir packages/ax-code exec vitest run` passed one file and one test, exercising the helper exported at `packages/ax-code/src/cli/cmd/compare.ts:169-171`. `pnpm --dir packages/ax-code run typecheck` also passed, including the command declaration shaped by `packages/ax-code/src/cli/cmd/cmd.ts:1-7`. These checks establish the present build and narrow regression baseline, while Step 8 records the missing handler-level coverage. The primary nine-step review is complete; the independently assigned `ax-code-glm` lane remains the verifier of record.
