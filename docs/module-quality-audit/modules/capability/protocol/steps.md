# Capability — 9-Step Dual-Agent Review (ax-code-glm)

Unit: `capability`
Scope: `packages/ax-code/src/capability/index.ts` (single file, 226 LOC)
Primary source read: `/Users/akiralam/code/ax-code/packages/ax-code/src/capability/index.ts`

## Step 1 — Scope and inventory confirmation

The `capability` unit is a single-file namespace module. `packages/ax-code/src/capability/index.ts:12` opens `export namespace Capability` and exposes six surface symbols: `Warning` schema (line 13), `Warning` type (line 18), `Info` schema (line 20), `Info` type (line 31), `list` function (line 33), and the namespace itself. There are no sub-modules, no barrel re-exports, and no `.ts` siblings under `src/capability/` (confirmed via directory listing). The module's job is purely aggregative: it merges five heterogeneous registries (instructions, commands, skills, agents, workflows) plus `Config.get()` into one `Info[]` catalog. Inventory matches the static map in `MODULE-AUDIT.md` (1 file / 227 LOC incl. trailing newline).

## Step 2 — Contract and call-site verification

Two stable call sites consume `Capability.list`: the CLI surface at `packages/ax-code/src/cli/cmd/capability.ts:36` (`Capability.list({ filePaths })` inside the `list` subcommand), and the HTTP surface at `packages/ax-code/src/server/routes/app.ts:186` (`Capability.list()` with no arguments, returned as JSON validated against `Capability.Info.array()` at line 179). The TUI additionally consumes the shape indirectly through `packages/ax-code/src/cli/cmd/tui/routes/session/capability-catalog.ts`, which re-declares a structurally identical `CapabilityCatalogItem` type (lines 1–15) rather than importing `Capability.Info`. Both real callers rely only on `list()` and the `Info` schema — no consumer touches the private `fromCommand`/`fromSkill`/`fromAgent`/`fromWorkflow` helpers, which are correctly kept module-local (not exported).

## Step 3 — Correctness of the aggregation pipeline

`list()` (lines 33–59) fans out six producers via `Promise.all` (line 34): `instructionEntries()`, `Command.list()`, `Skill.all()`, `Agent.list()`, `WorkflowTemplate.list()`, `Config.get()`. The parallel dispatch is correct — none of these depend on each other within this scope. The `deprecatedToolsAgents` set (lines 42–46) is computed from `config.agent` _before_ mapping agents, and is correctly consulted via `deprecatedToolsAgents.has(agent.name)` at line 52. Final sort uses a two-level comparator `a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)` (line 58) — stable and deterministic, matching the assertion in `test/capability/capability.test.ts:60-61`. One ordering subtlety worth recording: instructions are pre-sorted by path inside `instructionEntries` (line 172) but the outer sort reorders by kind first, so the inner `.sort()` is redundant for output ordering and only matters if a future caller relied on instruction-relative order.

## Step 4 — Per-kind adapter fidelity

Each adapter preserves the fields its source provides and synthesizes a `permissionImpact` metadata key:

- `fromCommand` (lines 61–91) collapses four boolean-ish signals into one of `workflow` / `mcp_prompt_permission` / `agent_permissions` / `default_agent_permissions` (lines 82–88) — the precedence (workflow → mcp → agent → default) is intentional and matches the workflow runtime's higher trust tier.
- `fromSkill` (lines 93–119) calls `Skill.matchByPaths([skill], filePaths)` _per skill_ (line 94). `Skill.matchByPaths` (`src/skill/index.ts:376-382`) accepts an array and is idempotent, so per-skill invocation is correct but redundant — see Step 5.
- `fromAgent` (lines 121–148) emits the `deprecated_agent_tools` warning (lines 129–137) only when the caller signals `deprecatedTools=true`; the test at `capability.test.ts:148-149` exercises this path.
- `fromWorkflow` (lines 150–169) sets `requiresWorkflowRuntime: true` unconditionally (line 165), consistent with the workflow runtime being mandatory for any workflow execution.

## Step 5 — Performance and scaling notes

Three observations, none Critical:

1. **Per-skill matchByPaths** (line 94): with N skills and M `filePaths`, the per-skill loop re-enters `Glob.match` N×M times through N separate calls. Batching into a single `Skill.matchByPaths(skills, filePaths)` and intersecting by name would collapse N calls to 1. For typical catalogs (tens of skills) this is negligible; flagging as a low-impact cleanup, not a defect.
2. **`compactMetadata` per entry** (lines 190–193): `Object.fromEntries(Object.entries(...).filter(...))` allocates two intermediate arrays per capability. Again negligible at catalog scale; relevant only if `list()` were ever called in a hot loop.
3. **No caching**: every CLI/HTTP invocation re-runs all five registries. The catalog is read-once-per-invocation today, so this is appropriate; caching would add staleness risk without payoff.

## Step 6 — Design and cohesion

The module has tight cohesion (single responsibility: catalog aggregation) and acceptable coupling. It imports from seven sibling modules (`agent`, `command`, `config`, `project`, `session/instruction`, `skill`, `workflow`, `util/filesystem`) — all read-only fan-in, no write-back. The `Info` schema (lines 20–30) is the canonical interchange type and is structurally duplicated in the TUI catalog type; that duplication is defensible because `packages/ax-code/src/cli/cmd/tui/...` runs in a Solid-rendered context that intentionally avoids importing server-side namespaces. One mild smell: `source` / `sourceTool` / `scope` are three near-overlapping string fields whose distinction is only clear from the per-adapter assignments (e.g. `fromAgent` line 126–128 sets all three to either `"builtin"` or `"config"`/`"ax-code"`). A short JSDoc on the `Info` schema documenting the intended difference would help future adapters, but this is documentation debt, not a structural defect.

## Step 7 — Hygiene, mutation, and error surface

- No empty `catch` blocks (audit map confirms 0).
- `addCommandSkillDuplicateWarnings` (lines 195–213) mutates `entry.warnings` in place by spreading the existing array (line 205). This is safe because `entries` is a fresh local array built in `list()`, never leaked to callers before this point.
- `compactMetadata` returning `undefined` when empty (line 192) is intentional and prevents `"metadata": {}` clutter in the JSON output.
- No `try/catch` wraps the `Promise.all`; if any producer rejects, the whole catalog call rejects. This is the correct behavior for an aggregation contract — partial catalogs would be misleading to the user.
- `permissionImpact(ruleset)` (lines 215–219) assumes `rule.action` is exactly `"allow" | "ask" | "deny"`; the type comes from `Agent.Info["permission"]`, which is the source of truth. No silent truncation risk.

## Step 8 — Finding register

No Critical or High findings. Three LOW observations recorded for traceability (not blocking):

| #   | Severity | Note                                                                                   | Location         |
| --- | -------- | -------------------------------------------------------------------------------------- | ---------------- |
| L1  | LOW      | Per-skill `matchByPaths` could be batched into one call.                               | `index.ts:94`    |
| L2  | LOW      | `Info.source` / `sourceTool` / `scope` overlap is implicit; doc comment would clarify. | `index.ts:20-30` |
| L3  | LOW      | Inner `.sort()` in `instructionEntries` is redundant under the outer kind/name sort.   | `index.ts:172`   |

No findings written to `findings/` because none rise to the project's finding-severity threshold; this ledger entry is the authoritative disposition.

## Step 9 — Verification and exit

- **Static extract**: matches `MODULE-AUDIT.md` fingerprint baseline (1 file, 6 exports, 0 empty catches, 0 TODOs).
- **Tests**: `packages/ax-code/test/capability/capability.test.ts` covers the four happy-path adapters (lines 22–127), the deprecated-tools warning (lines 129–153), and dotted relative instruction names (lines 155–177). All three assertions exercise public `Capability.list` behavior — no internal helpers are tested directly, which is consistent with the module's narrow public surface.
- **Determinism**: output ordering is asserted (test lines 60–61) and traceable to the comparator at `index.ts:58`.
- **Dual-agent gate**: this `steps.md` completes the primary-reviewer (ax-code-glm) 9-step pass. Verifier `codex-sol` should independently re-read `packages/ax-code/src/capability/index.ts` and the three test files listed in `MODULE-AUDIT.md` §1 before signing off. No Critical items exist, so no `reverify.md` second-pass is required by the protocol gate.

Exit status: REVIEWING → READY-FOR-VERIFY (primary 9-step complete, awaiting codex-sol independent confirm).
