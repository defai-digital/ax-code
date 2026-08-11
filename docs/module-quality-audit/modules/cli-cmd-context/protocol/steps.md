# Reviewer Protocol — cli-cmd-context

Reviewer: `codex-sol` (model `gpt-5.6-sol-xhigh`)
Independent verifier: `ax-code-glm`
Date: 2026-08-11

## Step 1 Scope and Entry Points

The `cli-cmd-context` unit is the yargs module at `packages/ax-code/src/cli/cmd/context.ts:11-129`; it exports `ContextCommand`, declares `context [sessionID]` at lines 12-18, and is wired into the executable command list at `packages/ax-code/src/cli/boot.ts:10,105`. The generic `cmd` helper only preserves yargs typing (`packages/ax-code/src/cli/cmd/cmd.ts:1-7`), so all runtime behavior belongs to the handler in this unit. Its direct collaborators are CLI presentation, project bootstrap, session storage, provider/model lookup, branded IDs, and the stats calculator (`context.ts:1-9`).

## Step 2 Data Exposure and Failure Boundaries

The command accepts one string identifier and does not interpolate it into SQL or a shell command; it compares the value against validated session objects in memory (`context.ts:33-39`). It prints the selected session ID and title (`context.ts:42-43`) plus provider/model names and usage totals (`context.ts:106-117`), which is expected for an explicitly invoked local diagnostic but means redirected output can contain conversation metadata. Storage and provider work run inside `bootstrap(process.cwd(), ...)` (`context.ts:23`); its `finally` always disposes the project instance (`packages/ax-code/src/cli/bootstrap.ts:4-17`). Model-resolution failures are deliberately converted to an unknown limit by the broad catch at `context.ts:82-88`, avoiding a crash but suppressing the distinction between a removed model and an operational provider failure.

## Step 3 Selection and Accounting Correctness

Default selection is deterministic: `Session.list` orders rows by descending `time_updated` (`packages/ax-code/src/session/index.ts:631-638`), so `sessions[0]` at `context.ts:33` is the latest project session. Explicit lookup is incomplete, however: the command first caps the list at 1,000 (`context.ts:24`) and then searches only that array (`context.ts:34`), so an existing older session ID is reported as not found. The accounting loop traverses messages chronologically because `Session.messages` reverses its newest-first stream (`session/index.ts:582-595`), making the final provider/model assignment at `context.ts:68-69` correspond to the last assistant message. The core context estimate is semantically wrong: lines 63-66 sum usage across every assistant turn, while the comparable live usage implementation reads only the last assistant and uses input plus cache-read tokens (`packages/ax-code/src/acp/usage.ts:43-60`). It then passes historical tool executions as `toolCount` (`context.ts:71-73,91-97`), although the calculator interprets that count as tool definitions at 800 tokens each (`packages/ax-code/src/stats/breakdown.ts:25-30`). Long, tool-heavy sessions can therefore be reported as nearly full when their current prompt is not.

## Step 4 Cost and Scalability

The handler materializes up to 1,000 session records (`context.ts:24`) even when the default needs one record, and `Session.messages` materializes every message and every part before the handler's linear scan (`session/index.ts:582-595`; `context.ts:57-75`). Runtime is O(sessions + messages + parts) and provider resolution occurs only once (`context.ts:82-89`), so there is no N+1 query pattern. For an occasional diagnostic the message scan is reasonable, but the fixed 1,000-session allocation is simultaneously wasteful for the default case and insufficient for arbitrary explicit IDs. Direct `Session.get` for an explicit ID and `Session.list({ limit: 1 })` for the default would be both cheaper and complete.

## Step 5 Responsibilities and Dependency Contracts

The module is appropriately thin at the CLI boundary: bootstrap owns instance lifetime (`context.ts:23-127`), `Session` owns persistence (`context.ts:24,46`), `Provider.getModel` owns discovery-aware model resolution (`packages/ax-code/src/provider/provider-impl.ts:1090-1128`), and stats owns rendering (`context.ts:91-100`). The boundary defect is the meaning of the stats input, not misplaced implementation: `calculateBreakdown` names `historyTokens` and `toolCount` (`stats/breakdown.ts:15-21`), but the caller supplies cumulative billed input and executed tool calls. Tightening that contract to accept an already-derived current-context token count, or deriving usage from the last assistant message as `acp/usage.ts:47-60` does, would prevent the CLI and calculator from assigning different meanings to the same values.

## Step 6 Maintainability and Diagnostic Clarity

All imports in `context.ts:1-9` are used, there are no TODO blocks, and the accumulator names at lines 48-55 match the summary emitted at lines 106-117. The catch at lines 84-88 is not empty—it explicitly assigns `undefined`—but it discards every exception without even a debug record, despite `Provider.getModel` being able to await discovery and throw a detailed not-found error (`provider-impl.ts:1095-1128`). The footer is also inaccurate for explicit selection: whenever more than one session exists it says “Showing latest” (`context.ts:120-123`), even if `args.sessionID` selected another session at lines 33-34. Both issues are small, local clarity defects.

## Step 7 Behavioral Coverage

The real-entrypoint smoke test creates one user and one assistant message with known tokens (`packages/ax-code/test/cli/smoke.test.ts:45-99`), invokes `context <sessionID>`, and checks the session, model, message count, input, and output text (`smoke.test.ts:364-388`). Calculator tests cover known/unknown limits, thresholds, and overflow-safe rendering (`packages/ax-code/test/stats/breakdown.test.ts:27-168`). Missing command-level cases are: no sessions (`context.ts:26-30`), missing ID (`context.ts:36-40`), omitted ID/latest ordering, an explicit non-latest session with multiple sessions, provider lookup success versus failure, cached usage, multiple assistant turns, tool parts, and a valid session beyond the 1,000-row cap. The existing happy path cannot detect any of the three findings below.

## Step 8 Findings and Severity

No Critical or High issue was found. Three non-blocking findings are accepted from this pass:

- **MEDIUM — current context is calculated from cumulative usage and tool executions.** `context.ts:57-75,91-97` sums every assistant's billed input and adds 800 tokens per tool part via `stats/breakdown.ts:25-30`; `acp/usage.ts:47-60` demonstrates the repository's last-assistant context convention. The command's primary percentage can be materially overstated.
- **MEDIUM — valid old session IDs can be rejected.** `context.ts:24,34-39` searches only the 1,000 most recently updated rows even when the user supplied an exact ID. Resolve explicit IDs directly instead of through the bounded recent list.
- **LOW — explicit selection is described as latest.** `context.ts:120-123` emits “Showing latest” solely from `sessions.length > 1`; gate that sentence on `args.sessionID === undefined` or reword it.

The unit's findings directory contained no Critical item during review, so the conditional `reverify.md` artifact is not required.

## Step 9 Verification and Exit Decision

`AX_TEST_FILES=test/cli/smoke.test.ts,test/stats/breakdown.test.ts pnpm exec vitest run` completed with 2 files and 24 tests passing. `pnpm --dir packages/ax-code run typecheck` also completed successfully. These checks establish that the present implementation builds and its covered behavior passes; they do not invalidate the uncovered semantic defects in Step 8. No production source or finding ledger was changed. The nine-step review for `cli-cmd-context` is complete and ready for independent verifier review by `ax-code-glm`.
