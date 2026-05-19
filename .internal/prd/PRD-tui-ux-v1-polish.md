# PRD: TUI UX v1 Polish

**Date:** 2026-05-16
**Status:** Drafted
**Scope:** Internal
**Owner:** ax-code agent
**Related:** TUI hardening track (opentui mainline, ratatui rejected 2026-04-25)

## Purpose

Ship six small, high-frequency UX wins in the session TUI that each user feels every interaction, without introducing new architectural primitives, mouse-heavy flows, or anything that conflicts with the autonomous-mode philosophy. Every item is additive to what already exists; nothing here rewrites an existing surface.

## Out of Scope

- Side-by-side diff mode (terminal-width fight, low ROI).
- Multi-session tabs / split panes.
- Theme editor or per-user theming surface.
- Mouse-heavy interactions (we keep keyboard-first).
- Health dots / capability badges on the provider/model selector — explicitly rejected (preserve v4.0.15 display format).
- Cost (dollar amount) in the streaming token chip — pricing data wiring through `models-snapshot.json` is a separate cleanup; v1 ships token counts only.
- `Always for this session` permission scope — overlaps autonomous-mode philosophy and needs a dedicated review (deferred).

## Items

### Item 1 — Coalesce consecutive same-tool calls

**Why:** When an autonomous turn fires 5–10 `read`s back-to-back to map a feature, each `read` renders its own `InlineTool` row. The transcript becomes a wall of nearly-identical lines and the user loses the actual reasoning between them. Coalescing the visual block (not the underlying data) is a transcript-density win that costs nothing semantically.

**Design:**
- New helper in `routes/session/index.tsx` that, when rendering the parts list, detects a run of ≥3 consecutive same-tool parts whose renderer is `InlineTool`-based and replaces them with a single `<CoalescedTool>` component: `→ Read · 5 files ▸` (click to expand to the individual rows).
- Eligible tools (read-only, low-info-per-row): `read`, `glob`, `grep`, `list`. NOT eligible: `bash`, `edit`, `write`, `apply_patch`, `task`, `webfetch`, `codesearch`, `websearch`, `refactor_*`, `todowrite`, `question`, `skill`.
- Threshold: ≥3 consecutive (2 is fine to render separately; 3+ is when fatigue starts).
- Expansion state lives in component-local `createSignal` keyed off the first callID of the run — collapses again on session navigation.
- A single error/denied in the run bursts the group (render all rows individually) so failures are never hidden.

**Acceptance:**
- New test `test/cli/cmd/tui/coalesce.test.ts` covering: 5 reads coalesce to 1 row; 2 reads stay separate; mixed run (read, read, grep) splits into 2 groups; run containing an errored read renders ungrouped.
- Visual sanity: bundled binary launch, exercise an autonomous turn that does many reads, confirm collapsed render and that expand restores all rows.

### Item 2 — Streaming token chip in footer

**Why:** `Usage.last()` already surfaces token info on completed turns. During streaming the user has no per-turn cost signal — they only know "still running, more tokens than before" via the progress step counter. A 1-chip footer addition lets a user gauge runaway-token turns mid-flight.

**Design:**
- In `routes/session/footer.tsx`, add a `tokenChip` memo: if route is `session` and there's an in-flight or last assistant message, render `↑{input} ↓{output}` (k-formatted). During streaming use `theme.accent`; on the final post-turn frame switch to `theme.textMuted` and persist until next user submit.
- Width-adaptive: only render at `dimensions().width >= 100` (same threshold as `showHints`). Drops off on narrow terminals before more critical chips do.
- Source of truth: most-recent assistant message in `sync.data.message[sessionID]`. The same data path `Usage.total()` already uses — no new sync surface.
- Cache tokens NOT shown in the chip (would double the width); cumulative cache info already lives in `/status`.

**Acceptance:**
- Manual: run a streaming turn, watch `↑` grow as input is staged and `↓` grow as output streams; confirm color flip at completion.
- New helper unit-tested in `routes/session/footer-view-model.ts`: `footerTokenChip({ message })` returns `{ input: "2.1k", output: "480" } | undefined` with proper k-suffix and undefined when no usage.

### Item 3 — Diff hunk summary header

**Why:** Edits today render the diff body straight inside `BlockTool`. For a large refactor the user has to scroll the diff before knowing the shape of the change. A single summary line ("3 hunks · +47 −12") above the diff is information density at near-zero implementation cost.

**Design:**
- New pure helper in `routes/session/format.ts`: `diffSummary(diff: string): { hunks: number; added: number; removed: number } | undefined` — scans the unified-diff text, counts `@@`-prefixed lines (hunks), lines starting with `+` but not `+++` (added), lines starting with `-` but not `---` (removed).
- In the `Edit` tool renderer (`routes/session/index.tsx`), render a one-line summary chip above the `SessionDiffRenderer` block when summary is defined: `<text fg={theme.textMuted}>{hunks} hunks · <span fg={theme.success}>+{added}</span> <span fg={theme.error}>−{removed}</span></text>`.
- Same chip in the `ApplyPatch` per-file renderer.
- The `Diff` permission prompt (`permission.tsx`) ALSO gets the chip — that's where summary value is highest (deciding whether to approve).

**Acceptance:**
- Unit test `test/cli/cmd/tui/diff-summary.test.ts` covering: empty diff → undefined; single-hunk +3/−1; multi-hunk count; `+++`/`---` excluded from counts; binary/empty patch returns undefined.

### Item 4 — Slash command frecency / "Recent" section

**Why:** Most users live on 3–5 slash commands (`/clear`, `/status`, `/loop`, project-specific). The picker currently shows `Suggested` (statically tagged) then full alphabetical list. Adding a "Recent" section based on real usage is a faster path for the most-used commands without re-tagging anything.

**Design:**
- KV key `slash_command_frecency: Record<commandValue, { count: number; lastUsed: number }>` — same storage pattern as existing `dismissed_getting_started` and theme KV usage. Bounded to ~20 entries (evict oldest by lastUsed when over).
- `useCommandDialog().trigger()` and `runCommandAction()` increment the counter on `route === "slash"` (not `keybind` — keybinds are already fast). Counter writes are debounced via the existing `KV.set` queue.
- In `DialogCommand`, before suggested+all, prepend a `Recent` category showing top 3 by frecency score `count / (1 + hoursSinceLastUse)`. Hidden when there are <2 entries (avoid a 1-item "Recent" looking awkward).
- "Recent" rows render only when `ref.filter` is empty — once user types to filter, the full alphabetical list takes over, same as today's `Suggested` behavior.

**Acceptance:**
- Unit test `test/cli/cmd/tui/slash-frecency.test.ts`: score formula correct; eviction at cap; filter input hides Recent section.
- Manual: invoke 4 different slashes, confirm top-3 appear in "Recent"; type to filter, confirm Recent disappears.

### Item 5 — Dim completed BlockTool titles

**Why:** `InlineTool` already dims to `textMuted` when the call completes (visual cue: "this is done, look at what's running"). `BlockTool` currently keeps its title color constant regardless of state. Running blocks should pop; completed ones should recede. This is a 4-line color-prop change.

**Design:**
- `BlockTool` (`routes/session/index.tsx`) accepts the existing `part?: ToolPart` — derive title color from `part.state.status`:
  - `running` / `pending` → `theme.text`
  - `completed` → `theme.textMuted`
  - `error` → `theme.error` (currently the title stays neutral and the error is rendered below — keep that, but the title also goes red so glancing scans surface the error)
- Border color of the `BlockTool` box stays `theme.borderSubtle` — we're not adding a second visual axis, just adjusting the title fg.

**Acceptance:**
- Manual: a running bash block has a bright title; once it completes the title fades; an errored block shows a red title.
- No new test — `BlockTool` is rendered in dozens of e2e snapshots; a focused color test would lock in styling against future theme tweaks for low gain.

### Item 9 — Sidebar section visual unification

**Why:** The Analysis (DRE) section is visually distinct (`backgroundColor={theme.backgroundElement}` panel + bold heading + subtle top border on the heading row). MCP, Queued, Activity etc. use bold heading + `border={["top"]}` but no panel background. The inconsistency makes the sidebar feel partially-rendered.

**Design:**
- Extract a `<SidebarSection title icon? expanded? onToggle? children>` component in `routes/session/sidebar.tsx` (file-local, not exported). Renders the panel background, the heading row (bold title + optional +/− toggle + optional count badge), and a `borderSubtle` divider before children.
- Migrate MCP and Queued sections to use it; keep Analysis on the same component (it already does this layout, the migration is just dedup).
- Visual: identical `backgroundElement` background to Analysis. Padding 1/1 inside the panel. Headings stay `<b>`.
- Do NOT touch Activity rendering — it's a flat list rather than a labeled section; reflowing it into a panel is a separate consideration.

**Acceptance:**
- Visual diff: launch TUI, confirm MCP and Queued visually match Analysis (panel bg, divider, bold heading, +/− toggle when applicable).
- No regression in collapse behavior (mcp/queued/dre still open/collapse at the same thresholds).
- No new automated test — pure layout extraction; verified by typecheck and visual exercise.

## Rollout

All six items default-on; none are gated by a flag.

- Items 1, 3, 5, 9 are pure rendering changes — no state migration, no schema change, no provider/server impact.
- Item 2 reads existing message tokens — no new event, no new sync surface.
- Item 4 writes a new KV key `slash_command_frecency`; absent on first load is normal (empty object). No migration.

Land order in the same PR (this is a single landing):
1. Item 5 (smallest blast radius, isolated color prop).
2. Item 3 (pure helper + 3 call sites).
3. Item 2 (footer chip + view-model helper).
4. Item 9 (component extraction).
5. Item 1 (coalescing — most complex).
6. Item 4 (KV write + sort).

Run `bun run typecheck` after each item.

## Risks

- **Coalescing hides errors.** Mitigated by the "burst on error" rule — a failed `read` in a run renders the whole run un-grouped.
- **Coalescing confuses keyboard navigation.** Current transcript navigation does not jump by tool-row; coalescing into one row means one navigation stop instead of N. Acceptable: fewer stops is the goal.
- **Token chip flicker during streaming.** Footer re-renders on every assistant message tokens-update. SolidJS memo dependency is `sync.data.message[sid]` — same pattern other footer chips already use, no new flicker source. If it does flicker, debounce the memo to 200ms.
- **Diff summary misparse on weird patches.** The helper returns `undefined` for empty/unparseable diffs and the chip is `<Show when={summary()}>` — no chip beats a wrong chip.
- **Slash frecency drift on shared KV.** KV is per-install (single `kv.json` in state dir) — no multi-user concern. The 20-entry cap bounds growth.
- **Sidebar section background contrast.** `backgroundElement` is already shipped for Analysis; reusing it for MCP/Queued won't introduce a new color. If the panel-on-panel reads as "muddy" on certain themes, fall back to no-bg + a divider-only treatment (cheap rollback).

## Non-goals (reiterated)

These came up during the suggestion review and are intentionally not in this slice:

- Toast "View details" expand.
- Session list last-message preview.
- Permission "session-scope" middle option.
- Header breadcrumb visual hint (`›`).
- Tool result auto-collapse threshold changes (per-tool thresholds already exist; tuning them is a separate calibration pass).
