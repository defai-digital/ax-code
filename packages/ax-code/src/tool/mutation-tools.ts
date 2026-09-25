/**
 * Classification of tool ids by what they do to the workspace.
 *
 * Provenance: `BlastRadius.recordWriteAndAssert` is the runtime's own "a write
 * happened" signal — it is what charges the file/line budgets and feeds the
 * snapshot. Every caller of it is by definition a workspace writer, so
 * `REGISTERED_MUTATION_TOOLS` is derived from that call graph rather than from
 * a hand-kept list.
 *
 * This module exists because the classification had been re-typed at each call
 * site and the copies drifted, which was not cosmetic: the goal completion gate
 * (`session/goal-verification.ts`, ADR-087/ADR-112) omitted `notebook_edit` and
 * `refactor_apply`, so a change made through either tool could land after the
 * model's last verification run without invalidating it, while other call sites
 * already counted the same id as a mutation.
 */

/**
 * Registered tools that write the workspace, each verified against its
 * implementation. Adding a tool that writes files means adding it here, and
 * forgetting is what this module exists to prevent.
 */
export const REGISTERED_MUTATION_TOOLS: readonly string[] = Object.freeze([
  "edit",
  "write",
  "apply_patch",
  "multiedit",
  "notebook_edit",
  "refactor_apply",
  // Writes the generated artifact into the workspace through the same
  // recordWriteAndAssert path as the editors, so the runtime already treats it
  // as a write and the gate must agree.
  "image_gen",
])

/**
 * Ids accepted as mutations without a built-in registration. `patch` is not a
 * registered tool id today; it is kept because a plugin may register it and a
 * superset is the safe direction for a gate whose failure mode is accepting
 * unverified changes.
 */
export const UNREGISTERED_MUTATION_ALIASES: readonly string[] = Object.freeze(["patch"])

/**
 * Tools that change the workspace on disk. Used for mutation detection
 * (substantial-change verification), goal progress accounting, source scoping,
 * and the own-message write attribution that computes `externalFiles`.
 */
export const MUTATION_TOOLS: ReadonlySet<string> = new Set([
  ...REGISTERED_MUTATION_TOOLS,
  ...UNREGISTERED_MUTATION_ALIASES,
])

/**
 * Mutation tools plus read-only tools that report a file path. Used where a
 * message's accessed-file list must cover both reading and writing.
 */
export const FILE_TOUCHING_TOOLS: ReadonlySet<string> = new Set(["read", ...MUTATION_TOOLS])

/**
 * Known limitations, deliberately not fixed here:
 *
 * - A shell command can write files (`echo >`, `sed -i`, `git apply`) and
 *   `bash` is not in `MUTATION_TOOLS`. It must not be: bash is also the gate's
 *   verification tool, so counting it as a mutation would make "verification
 *   after the last mutation" unsatisfiable — the verification run would itself
 *   be the last mutation. `bash-impl.ts` does record detected writes for the
 *   blast-radius budgets, so the signal exists; using it in the gate needs its
 *   own decision about which writes count and how to avoid that livelock.
 * - Tools that run work in a child session (`task`, `task_parallel`, `batch`)
 *   can mutate the workspace through a subagent. The gate scans the parent
 *   session's message list, so those changes are invisible to it. Closing that
 *   needs a cross-session write signal, not a bigger id set.
 * - `ops_apply` mutates external infrastructure rather than repository files,
 *   so it is out of scope for a workspace-change classification.
 *
 * Membership is not extraction: knowing a tool writes is useless unless its
 * changed paths can be read back, and each writer reports them differently
 * (`filediff.file`, apply_patch `files[]`, multiedit `results[]`,
 * `notebook_path`, refactor_apply `filesChanged[]`). Consumers that need paths
 * handle those shapes; consumers that only need "did anything change" use this
 * set.
 *
 * Sets outside this module that deliberately keep their own membership:
 * - `permission/index.ts` `EDIT_TOOLS` maps an id onto a permission, so
 *   widening it would let a tool that currently asks fall under an
 *   already-granted `edit` rule — a permission boundary decision.
 * - `config/schema-impl.ts`, `config/config-impl.ts` map ids onto the `edit`
 *   permission for config rules, same boundary, keyed by string.
 * - `hooks/lifecycle.ts` matches ids with a regex inside a hook matcher.
 * - Display classification: `cli/cmd/run-output.ts` (blocked-run rule, counts
 *   `bash`), `graph/format.ts`, `quality/dre-graph/*`.
 * Those are presentation or boundary questions, not "did the workspace change".
 */
