# cli-cmd-tui-tool-renderers — 9-step review

Reviewer: `codex-sol`; independent verifier: `ax-code-glm`. This primary pass follows renderer selection from the policy table through Solid components, shared formatting/view helpers, and the session-route consumer.

## Step 1 Scope and dispatch surface

The `cli-cmd-tui-tool-renderers` unit consists of the eight files under `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/` plus `packages/ax-code/src/cli/cmd/tui/routes/session/tool-rendering.ts`. The policy declares every specialized key and the generic fallback at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-rendering.ts:1-22`; the component registry supplies a renderer for that same key union at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/index.tsx:15-36`. The live session route resolves the tool name and mounts the selected component at `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx:2021-2032`.

## Step 2 Data and side-effect boundaries

These components render tool inputs, metadata, output, and permission state; they do not execute shell commands or edit files. Bash metadata and generic output have ANSI escapes removed before display at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/file-edits.tsx:20-31` and `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/generic.tsx:9-18`. The delegated-task renderer is the one scoped component with an asynchronous boundary: it requests a missing child-session preview and handles rejection with structured logging at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/task.tsx:20-29`. The actual refactor write/permission boundary remains in the producer, which identifies `refactor_apply` as the only writing DRE tool and calls `ctx.ask` at `packages/ax-code/src/tool/refactor_apply.ts:12-18,44-66`.

## Step 3 Selection and fallback correctness

Known names are recognized through the set derived from the canonical tuple, while every other string becomes `generic` at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-rendering.ts:24-34`. The `Record<SessionToolRendererKey, ToolRendererComponent>` declaration at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/index.tsx:13-36` makes missing or misspelled registry entries a type error. Coalesced read/list/glob/grep groups receive human labels and other tools retain their raw name at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-rendering.ts:36-42`; the route also shows a spinner whenever any grouped part is pending or running at `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx:2043-2057`.

## Step 4 State, interaction, and failure behavior

`InlineTool` derives permission highlighting from the active call ID, distinguishes denials from ordinary errors, preserves mouse text selection, and renders non-denial errors at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/primitives.tsx:39-60,62-109`. `BlockTool` similarly colors running/completed/error titles and surfaces the part error at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/primitives.tsx:121-165`. File edit previews deliberately pass the complete patch to the diff renderer and collapse only the containing box, avoiding invalid mid-hunk truncation (`packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/file-edits.tsx:136-169`). Task clicks navigate only when a child session ID exists at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/task.tsx:75-86`.

## Step 5 Rendering cost and output bounds

Bash and Write previews collapse after 10 and 20 lines and cap expanded content through `capLines` at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/file-edits.tsx:21-31,80-90`; the helper enforces a default ceiling of 500 lines at `packages/ax-code/src/cli/cmd/tui/routes/session/format.ts:86-99`. Refactor plans cap affected-file rows at 15 (`packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/dre.tsx:69-79`), and dedup reports cap clusters and members at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/dre.tsx:294-297,319-356`. Two non-Critical residual risks remain: generic output expands without a hard cap at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/generic.tsx:13-18`, and Impact slices each distance bucket by 15 while calculating one global remainder at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/dre.tsx:247-268`, which can over-render and overstate hidden rows when results span multiple distances.

## Step 6 Structure and type hygiene

Responsibility is mostly well divided: `tool-rendering.ts` owns name policy, `index.tsx` owns component dispatch, `primitives.tsx` owns shared state chrome, and domain files own their display decisions. Renderer modules are prevented from importing the large route index by `packages/ax-code/test/cli/tui/session-tool-rendering.test.ts:34-49`. Type precision is uneven: WebFetch discards its available tool type with casts, CodeSearch/WebSearch accept `ToolProps<any>` at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/basic.tsx:46-69`, and Task casts tool state to read `title` while retaining unused context hooks through `void` statements at `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/task.tsx:43,61,72-73`. These are maintenance debts, not evidence of a Critical runtime failure.

## Step 7 Test evidence and gaps

Policy tests exercise every specialized key, unknown-name fallback, stable group labels, and module independence at `packages/ax-code/test/cli/tui/session-tool-rendering.test.ts:11-49`. The long-edit regression verifies that the complete raw diff reaches the renderer and clipping occurs outside it at `packages/ax-code/test/cli/tui/session-route-fixes.test.ts:32-44`; the delegated preview rejection guard is asserted at `packages/ax-code/test/cli/tui/render-anti-patterns.test.ts:256-264`. Helper coverage exists for view and formatting logic, but there is no direct component-level test of expand/collapse output, denial classification, DRE grouped limits, or renderer error-boundary fallback. That gap is especially relevant to the two residual behaviors in Step 5.

## Step 8 Register reconciliation

The current register says `_none accepted_` at `docs/module-quality-audit/modules/cli-cmd-tui-tool-renderers/MODULE-AUDIT.md:87-92`, and the unit has no files under `findings/`. The independent source pass found no Critical-severity evidence. The uncapped generic expansion and per-distance Impact limit are recorded here as non-Critical review observations; the requested artifact set does not authorize a new findings ledger entry. Because there is no Critical item and this is the primary `codex-sol` pass, `reverify.md` is not created.

## Step 9 Targeted verification and exit

I ran `AX_TEST_FILES=test/cli/tui/session-tool-rendering.test.ts,test/cli/tui/session-route-fixes.test.ts,test/cli/tui/render-anti-patterns.test.ts,test/cli/tui/session-format.test.ts,test/cli/tui/session-view-model.test.ts pnpm --dir packages/ax-code exec vitest run`; Vitest reported 5 files and 130 tests passed. This directly covers the registry policy and the principal helper/regression guards cited above. The audit records the dual-agent protocol and sign-off as complete at `docs/module-quality-audit/modules/cli-cmd-tui-tool-renderers/MODULE-AUDIT.md:93-113`; these artifacts supply the nine-step primary evidence while retaining `ax-code-glm` as the named independent verifier.
