# Product Requirements Document (PRD)

# DRE UI — Tier 3 (deferred surfaces)

**Document Version:** 0.1 — Draft
**Date:** 2026-04-05
**Status:** Draft — Deferred (not scheduled for v2.3.x)
**Related:**
- `automatosx/prd/PRD-debug-refactor-engine.md` — the core DRE PRD
- `automatosx/adr/ADR-debug-refactor-engine.md` — architecture decisions
- v2.3.1 release — shipped Tier 1 (approval context + discoverability + footer chip) and Tier 2 (custom renderers for refactor_plan, refactor_apply, impact_analyze, dedup_scan)

---

## 0. TL;DR

v2.3.1 made DRE visible in the TUI for its four highest-value surfaces. This PRD documents the **five remaining UI gaps** that were deliberately deferred, with acceptance criteria so they can be implemented later without re-deriving the scope.

Nothing here is urgent. Each item is listed with an explicit trigger condition — the signal that says "now is the right time to ship this one".

**The five deferred items:**

1. Custom renderer for `debug_analyze` — stack-chain with role badges
2. Custom renderer for `hardcode_scan` — linter-style findings list
3. `debug-engine.*` Bus events wired end-to-end
4. Web/desktop parity — the app's `packages/ui` tool renderers
5. Generic tool browser in the command palette

Everything else users need for DRE was either shipped in v2.3.1 (Tier 1 + Tier 2) or is the message-timeline rendering of tool outputs that ships for free with `Tool.define()`.

---

## 1. Context

### 1.1 What v2.3.1 already shipped

| Surface | Status |
|---|---|
| `refactor_plan` custom renderer (markdown summary + edit list + affected files) | shipped |
| `refactor_apply` custom renderer (3-row check matrix + abort reason + files changed) | shipped |
| `impact_analyze` custom renderer (risk badge + grouped distances + truncation flag) | shipped |
| `dedup_scan` custom renderer (cluster accordion + tier colors + suggestion) | shipped |
| `refactor_apply` permission modal context (plan id + mode + preflight vs real + files) | shipped |
| Footer chip for pending refactor plans | shipped |
| Slash commands (`/debug`, `/impact`, `/dedup`, `/hardcode`, `/refactor`, `/plans`) | shipped |
| `GET /debug-engine/pending-plans` server route | shipped |

### 1.2 What this PRD covers

Everything in v2.3.1 was scoped to "close the two gaps that are actually safety or discoverability risks" plus "bring the four highest-structure outputs up to parity with edit/apply_patch/todowrite rendering". The five items below are lower-priority polish:

- Two of them (`debug_analyze`, `hardcode_scan`) render acceptably through the `GenericTool` fallback today because their outputs are naturally text-shaped. The custom renderers would be nicer but are not blocking.
- Two of them (app parity, Bus events) are cross-surface scope that requires coordination with the web/desktop maintainers and the replay subsystem.
- One of them (tool browser) is a **general TUI feature** that happens to benefit DRE — it's not DRE-specific and shouldn't be built under the DRE scope.

### 1.3 What this PRD deliberately doesn't cover

- **DRE dashboard panel** — rejected in the original review. The TUI has no persistent side panels; every structured rendering lives inline in the message timeline or in an overlay modal. A dashboard would be architecturally inconsistent.
- **Inline annotation of `hardcode_scan` findings in `Read` output** — rejected. The `Read` tool does not host an annotation layer, and building one is ~10× the scope of DRE itself.
- **Real-time progress spinners for DRE operations** — rejected. The existing `InlineTool` component already renders `pending` state with `spinner={true}`; the Tier 2 renderers use it.
- **"DRE mode" chrome change** — rejected. Plan mode changes chrome because it switches agents. DRE is tool calls inside the normal agent loop, not a mode.

---

## 2. Items

### Item 1 — Custom renderer for `debug_analyze`

#### Why it's deferred

`debug_analyze` returns a chain of stack frames (file, line, role, resolved symbol). The output is compact text that fits inside `GenericTool`'s 3-line preview when the chain is short, and the click-to-expand path handles deeper chains. A reviewer can still read the resolved symbols and confidence score.

#### Why we'd eventually build it

Users who look at `debug_analyze` output want to **click a frame to jump to the file** — a capability the generic text preview doesn't afford. Custom rendering would also let us:

- Color the failure frame (role = "failure") red, intermediate frames muted, entry frames green
- Show a warning badge when `truncated: true`
- Show the confidence score with a colored bar (green > 0.8, yellow 0.4-0.8, red < 0.4)
- Render unresolved frames (symbol = null) visually distinct so users see which frames failed to match the graph

#### Trigger

Ship this when **either**:
- User feedback says "I can't see the chain clearly" or "I wish I could click through the stack", OR
- We add file-jump navigation to the TUI generally — at which point `debug_analyze` should use it immediately.

#### Acceptance criteria

- New `DebugAnalyze` function in `session/index.tsx` (consistent with where `RefactorPlan` / `ImpactAnalyze` live)
- Pending state: `InlineTool` with `#` or `⚑` icon + spinner
- Complete state: `BlockTool` with:
  - Header: `# Debug analyze · confidence {n}`
  - Role-badge per frame (failure/intermediate/entry) with distinct colors
  - Unresolved frames rendered with strikethrough or `<unresolved>` marker
  - Truncation warning row when `truncated: true`
  - Heuristic tags from `explain.heuristicsApplied` in a dim footer row
- Wired into the session tool Match before the `GenericTool` fallback
- No test regressions; touches `session/index.tsx` only

#### Scope estimate

~120 lines in `session/index.tsx`. No new files, no server changes.

---

### Item 2 — Custom renderer for `hardcode_scan`

#### Why it's deferred

`hardcode_scan` returns a flat findings list already sorted by severity. `GenericTool` renders this acceptably — each finding is one line, so ~3 lines fit in the preview and the user can click-to-expand for the full list.

#### Why we'd eventually build it

Users doing tech-debt cleanup will scan dozens or hundreds of findings and want:

- Severity colors (high = red, medium = yellow, low = muted) instead of plain text
- Kind-based grouping (all magic numbers together, all URLs together) as a display option
- A per-finding action hint (e.g. "move to config.ts") that stands out from the surrounding code
- File-level grouping so repeated findings in the same file collapse visually

#### Trigger

Ship this when either:
- User feedback says "hardcode output is hard to scan in the timeline", OR
- We add a shared linter-style findings-list component (useful beyond DRE), at which point `hardcode_scan` should use it.

#### Acceptance criteria

- New `HardcodeScan` function in `session/index.tsx`
- Pending state: `InlineTool` with `◈` icon
- Complete state: `BlockTool` with:
  - Header: `# Hardcode · {n} findings ({high} high / {medium} medium / {low} low)`
  - Findings grouped by kind, each kind as a sub-section
  - Severity color per finding
  - Inline severity badge before each row
  - Truncation warning row when `truncated: true`
  - Cap at 40 visible findings with "… and N more" tail (cap already enforced in the metadata)
- Wired into the session tool Match

#### Scope estimate

~100 lines in `session/index.tsx`.

---

### Item 3 — Wire `debug-engine.*` Bus events end-to-end

#### Why it's deferred

The core DRE PRD specified 6 Bus events:

- `debug-engine.analyze.started` / `.completed`
- `debug-engine.plan.created`
- `debug-engine.apply.started` / `.completed` / `.aborted`

None are implemented. v2.3.1 reaches its UX goals **without** them because:

1. The message-timeline tool renderer already shows running / complete / failed states from the standard `tool.call` / `tool.result` events the session recorder emits for every tool.
2. The footer plans chip polls `GET /debug-engine/pending-plans` on the same cadence as the LSP indicator, so "a new plan appeared" surfaces within one LSP event cycle.
3. Audit + replay work through the same `tool.call` / `tool.result` path.

Adding Bus events now would be a second channel saying the same thing louder, without a consumer who needs the lower latency.

#### Why we'd eventually build them

Bus events become load-bearing when **a consumer needs sub-second reactivity to DRE state changes**. Concrete consumers:

1. **Web app `status-popover.tsx` DRE tab** (Item 4 below) — would want push updates, not poll
2. **TUI toasts** — e.g., a toast that says "Refactor applied: 7 files changed" as soon as `applySafeRefactor` returns, so users who scrolled away from the tool output don't miss the result
3. **Replay** — would capture DRE events for turn-by-turn reconstruction in `/replay` sessions, useful for debugging DRE itself
4. **Metrics / telemetry** — e.g., `debug_engine.apply.aborted` with `abortReason` in properties drives the "abort rate" dashboard the core PRD §7 lists

#### Trigger

Ship this when **Item 4 starts** — the app DRE tab is the first real consumer. Until then, the events would be dead infrastructure.

#### Acceptance criteria

- New file `src/debug-engine/bus.ts` defining 6 events via `BusEvent.define`, each with a zod schema covering the payload
- `Bus.publish` calls inserted at the entry and exit points of `analyzeBugImpl`, `planRefactorImpl`, `applySafeRefactorImpl`
- Payloads carry enough to reconstruct the timeline: `planId`, `projectID`, `risk`, `checks` (for `apply.*`), `abortReason` (for `apply.aborted`)
- Replay captures them automatically via the existing global bus bridge
- Unit tests verify publish-on-happy-path and publish-on-abort-path
- Existing DRE tests still pass (row-count guard still holds — Bus events don't write to v3 tables)

#### Scope estimate

~200 lines across 4 files. Medium.

---

### Item 4 — Web / desktop parity

#### Why it's deferred

The app (`packages/app/`) and desktop (Tauri wrapper over app) have **zero custom tool renderers today** — `BasicTool` handles every tool. This isn't a DRE gap; it's an app-wide gap that also affects `edit`, `apply_patch`, `todowrite`, etc. The app is deliberately lagging the TUI.

Shipping DRE-specific renderers in the app while the app has no renderers for its own core tools would be an inconsistent priority inversion.

#### Why we'd eventually build it

Users who work in the web/desktop app will hit the same "3-line generic preview isn't enough" problem as TUI users did before v2.3.1. When the app starts shipping any tool-specific renderers (most likely `edit` and `apply_patch` first, since those are the most structured), DRE should follow in the same pass.

#### Trigger

Ship this when **any** custom tool renderer lands in the web app. The moment the precedent exists, DRE's four renderers should be ported in the same sprint for consistency.

#### Acceptance criteria

- Four renderers in `packages/ui/src/components/tool-parts/` (or wherever the app's renderer registry lives):
  - `refactor-plan.tsx`
  - `refactor-apply.tsx`
  - `impact-analyze.tsx`
  - `dedup-scan.tsx`
- Registered via `registerPartComponent()` in the app's part mapping
- Visual parity with the TUI renderers: same data displayed, same groupings, same color semantics, web-idiomatic layout
- App footer / `status-popover.tsx` grows a DRE tab showing pending plans (mirror of the TUI footer chip) **if and only if** Item 3 lands (Bus events → SSE → app)
- Desktop inherits automatically since it renders the web app

#### Scope estimate

~800-1200 lines across 5-8 files, depending on how far the app's part-mapping system has matured by then.

---

### Item 5 — Generic tool browser in the command palette

#### Why it's deferred

Today tool discovery happens through three channels:

1. The agent prompt (tools are in the system prompt)
2. Release notes
3. Slash commands (for the handful of tools that have them)

None of these let a user browse **what tools exist**, which is a pain point that goes far beyond DRE. Someone enabling `AX_CODE_EXPERIMENTAL_LSP_TOOL` or `AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE` has the same discoverability problem as someone enabling DRE.

The right fix is a generic "browse available tools" surface in the command palette (`ctrl+k`), not a DRE-specific tool list.

#### Why we'd eventually build it

Tool discoverability is the single biggest UX debt in the experimental-flag system. Every new tool behind a flag is invisible until the user knows to look for it. A tool browser fixes that permanently.

#### Trigger

Ship this when **a second experimental tool family** (beyond DRE) introduces ≥3 tools users need to discover. At that point the general solution is cheaper than wiring discovery per-feature.

#### Acceptance criteria

- New command palette entry: `Browse available tools` (keybind TBD)
- Lists every registered tool with:
  - Tool id
  - Short description (first line of `description` field from `Tool.define()`)
  - Category (from the agent preset that enables it, or a new `category` field on `Tool.Info`)
  - Experimental flag that gates it, if any
  - Whether the current agent has permission to call it
- Click-through: selecting a tool drops a `Use <tool> to …` scaffold into the prompt, similar to the DRE slash commands
- Filter / search by name or category
- Does not require touching individual tool definitions beyond an optional `category: string` field

#### Scope estimate

~500 lines. Medium. Scope belongs to the command palette / tool registry team, not the DRE team.

---

## 3. Cross-cutting non-goals

- **No new DRE features.** This PRD is UI polish. Any new feature (Go stack parser, embedding-based dedup, LLM reasoning integration) goes through the core DRE PRD's phase plan, not here.
- **No changes to the DRE tool wrapper contracts.** The metadata shapes refactor_plan/refactor_apply/impact_analyze/dedup_scan return are already stable in v2.3.1 and Tier 2 renderers depend on them.
- **No changes to the permission rule system.** `refactor_apply` continues to route through `permission: "edit"`; the Tier 1c custom body lives inside the existing edit branch.
- **No changes to session DB schema.** Pending-plan queries hit `debug_engine_refactor_plan` via the existing query layer.

---

## 4. Priority order (if all five were to ship)

1. **Item 3 (Bus events)** — cheapest, unlocks Item 4
2. **Item 1 (debug_analyze renderer)** — highest individual UX value after Tier 2
3. **Item 2 (hardcode_scan renderer)** — paired with Item 1, same cost model
4. **Item 4 (app parity)** — largest scope, blocked on broader app rendering decisions
5. **Item 5 (tool browser)** — generic feature; DRE is a consumer, not the driver

None of the five should be scheduled as a single release. They ship when their individual triggers fire.

---

## 5. Decision principles inherited from DRE core

1. **Deterministic first, LLM last.** No LLM calls inside any of these renderers — they operate on structured metadata already produced by the tools.
2. **Explainable by construction.** Every DRE output already carries an `explain` field; Tier 3 renderers must surface it when available (heuristic tags row, graph query count, completeness label).
3. **No new runtimes.** TypeScript / Bun / SolidJS for TUI, React for app. Same as today.
4. **Compose, don't replace.** Reuse `BlockTool` / `InlineTool` in the TUI; reuse the app's existing tool-part registry pattern when it exists.
5. **Humans in the loop on writes.** All existing `ask` flows remain — Tier 3 doesn't change any permission behavior.
6. **Scope discipline.** Five items. Not six. New polish requests go into a new section or a follow-up PRD.
