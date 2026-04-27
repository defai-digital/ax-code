import fs from "fs/promises"
import path from "path"
import { git } from "../util/git"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { CodeIntelligence } from "../code-intelligence"
import type { ProjectID } from "../project/schema"
import { resolveCommands, runCheck, runTests } from "../planner/verification/runner"
import { DebugEngine } from "./index"
import { DebugEngineQuery } from "./query"
import { ShadowWorktree } from "./shadow-worktree"
import { extractFilesFromDiff } from "./analyze-impact"
import { RefactorPlanID } from "./id"

// applySafeRefactor — orchestrates the Plan → Validate → Apply pipeline
// (ADR-006, PRD §4.5).
//
// The pipeline is intentionally boring: every step is a single shell
// command or a single graph query, the decision gate is a plain if/else,
// and the rollback path is "never left the shadow in the first place".
// No LLM roundtrips, no retries, no smart recovery.
//
// Phase 3 scope — what actually ships:
//   1. Load plan by id; refuse if missing or not in "pending" status
//   2. Freshness check: compare graph cursor to the snapshot stored at
//      plan creation. If the graph has moved, mark the plan stale and
//      abort.
//   3. Open a shadow worktree via ShadowWorktree.open
//   4. Apply the plan's `patch` field if present. In Phase 3, plans
//      produced by planRefactor do NOT carry a patch — that's a
//      separate transformation step owned by the agent layer (the
//      agent constructs the patch from the edit list, typically via
//      an LLM, then passes it back via input.patch). If no patch is
//      supplied, the pipeline runs typecheck + lint as a pre-flight
//      sanity check and aborts with reason "no-patch-supplied".
//   5. Typecheck via the project's typecheck command
//   6. Lint via the project's lint command (optional — skipped if not
//      configured)
//   7. Tests via the project's test command, scoped to affected files
//      when findDependents returns anything, otherwise a full-suite
//      fallback (PRD §4.5 step 6)
//   8. Decision gate: any failure → abort, rollback, no changes applied
//   9. Apply patch to the real worktree via git apply from the shadow
//      diff. Update plan status.
//
// Safe vs aggressive mode:
//   - safe (default): every step runs
//   - aggressive: step 6 (lint) and step 7 (tests) can be skipped via
//     the skipLint and skipTests knobs. Typecheck is NEVER skipped.

const log = Log.create({ service: "debug-engine.apply-safe-refactor" })

export type ApplySafeRefactorInput = {
  planId: RefactorPlanID
  mode?: "safe" | "aggressive"
  // Optional patch string supplied by the caller. When present, the
  // pipeline applies it inside the shadow worktree before running
  // checks. When absent, the pipeline runs checks as a pre-flight
  // sanity test and aborts with abortReason "no-patch-supplied".
  patch?: string
  // Override the commands the pipeline runs. Defaults are inferred
  // from the project layout:
  //   typecheck: "bun typecheck" if package.json has the script
  //   lint: null unless package.json has a lint script
  //   test: "bun test" if package.json has one
  commands?: {
    typecheck?: string | null
    lint?: string | null
    test?: string | null
  }
  // Aggressive-mode escape hatches. Require mode="aggressive".
  skipLint?: boolean
  skipTests?: boolean
}

function isPlanStale(params: { planCursor: string | null; currentCursor: string | null }): boolean {
  // No cursor recorded at plan time → freshly-created plan on a
  // not-yet-committed branch. Treat as fresh.
  if (params.planCursor === null) return false
  // No current cursor → graph was never indexed after the plan was
  // created. Ambiguous; treat as fresh but note uncertainty in
  // heuristics.
  if (params.currentCursor === null) return false
  return params.planCursor !== params.currentCursor
}

export async function applySafeRefactorImpl(
  projectID: ProjectID,
  input: ApplySafeRefactorInput,
): Promise<DebugEngine.ApplyResult> {
  const mode = input.mode ?? "safe"
  const heuristics: string[] = [`mode=${mode}`]
  const scope: "worktree" | "none" = "worktree"

  const emptyChecks = (): DebugEngine.ApplyResult["checks"] => ({
    typecheck: { ok: false, errors: [] },
    lint: { ok: true, errors: [] },
    tests: { ok: true, errors: [], ran: 0, failed: 0, failures: [], selection: "skipped" },
  })

  const abort = (reason: string, checks?: DebugEngine.ApplyResult["checks"]): DebugEngine.ApplyResult => ({
    applied: false,
    planId: input.planId,
    checks: checks ?? emptyChecks(),
    filesChanged: [],
    rolledBack: false,
    abortReason: reason,
    explain: DebugEngine.buildExplain("apply-safe-refactor", [], heuristics),
  })

  // Step 1: load plan.
  const row = DebugEngineQuery.getPlan(projectID, input.planId)
  if (!row) return abort("plan-not-found")
  if (row.status !== "pending") {
    return abort(`plan-status-${row.status}`)
  }
  heuristics.push(`plan-kind=${row.kind}`)

  // Step 2: freshness check.
  const status = CodeIntelligence.status(projectID)
  if (row.graph_cursor_at_creation !== null && status.lastCommitSha === null) {
    heuristics.push("cursor-missing-current")
  }
  if (isPlanStale({ planCursor: row.graph_cursor_at_creation, currentCursor: status.lastCommitSha })) {
    DebugEngineQuery.updatePlanStatus(projectID, input.planId, "stale")
    heuristics.push("stale-plan")
    return abort("plan-stale")
  }

  // Step 3: preconditions + shadow worktree.
  if (Instance.project.vcs !== "git") {
    return abort("not-a-git-worktree")
  }

  const shadow = await ShadowWorktree.open({ planId: row.id })
  if (!shadow.ok) {
    heuristics.push(`shadow-open-failed:${shadow.reason}`)
    return abort(`shadow-${shadow.reason}`)
  }

  // Ensure the shadow is cleaned up on every code path. `await using`
  // would be cleaner but requires a block scope; the finally pattern
  // is equivalent and easier to integrate with the decision-gate
  // branching below.
  const shadowHandle = shadow.handle
  const shadowCleanup = async () => {
    try {
      await shadowHandle[Symbol.asyncDispose]()
    } catch (err) {
      log.warn("shadow disposal failed", { err })
    }
  }

  try {
    // Step 3.5: symlink node_modules from the real worktree into the
    // shadow so typecheck/lint/test commands can resolve dependencies.
    // .gitignore'd directories aren't present in git worktrees.
    const realNodeModules = path.join(Instance.worktree, "node_modules")
    const shadowNodeModules = path.join(shadowHandle.path, "node_modules")
    const hasNodeModules = await fs
      .stat(realNodeModules)
      .then(() => true)
      .catch(() => false)
    if (hasNodeModules) {
      await fs.symlink(realNodeModules, shadowNodeModules, "junction").catch(async () => {
        // Symlink failed (e.g., Windows without dev mode) — skip, checks
        // will attempt to run without node_modules. This is best-effort.
        log.warn("could not symlink node_modules into shadow", { shadow: shadowHandle.path })
      })
      heuristics.push("node_modules-linked")
    }

    // Step 4: optional patch application. Phase 3 plans produced by
    // planRefactor don't carry a patch — a caller (typically an agent
    // at the tool layer) is expected to construct one from the edit
    // list and pass it back here.
    if (input.patch) {
      const patchFile = path.join(shadowHandle.path, ".dre.patch")
      await fs.writeFile(patchFile, input.patch, "utf8")
      const applyResult = await git(["apply", "--whitespace=fix", patchFile], {
        cwd: shadowHandle.path,
      })
      await fs.rm(patchFile, { force: true }).catch(() => undefined)
      if (applyResult.exitCode !== 0) {
        heuristics.push("patch-apply-failed")
        return abort("patch-apply-failed")
      }
      heuristics.push("patch-applied-in-shadow")
    } else {
      heuristics.push("no-patch-supplied")
    }

    // Step 5–7: run checks in order. Each check is run against the
    // shadow, never against the real worktree.
    const commands = await resolveCommands(shadowHandle.path, input.commands)
    heuristics.push(
      `cmd:typecheck=${commands.typecheck ? "yes" : "no"}`,
      `cmd:lint=${commands.lint ? "yes" : "no"}`,
      `cmd:test=${commands.test ? "yes" : "no"}`,
    )

    const typecheckCheck = await runCheck("typecheck", commands.typecheck, shadowHandle.path)
    if (!typecheckCheck.ok) {
      return abort("typecheck-failed", {
        typecheck: { ok: typecheckCheck.ok, errors: typecheckCheck.errors },
        lint: { ok: true, errors: [] },
        tests: { ok: true, errors: [], ran: 0, failed: 0, failures: [], selection: "skipped" },
      })
    }

    const lintCheck =
      mode === "aggressive" && input.skipLint
        ? { ok: true, errors: [], skipped: true }
        : await runCheck("lint", commands.lint, shadowHandle.path)
    if (!lintCheck.ok) {
      return abort("lint-failed", {
        typecheck: { ok: true, errors: [] },
        lint: { ok: false, errors: lintCheck.errors },
        tests: { ok: true, errors: [], ran: 0, failed: 0, failures: [], selection: "skipped" },
      })
    }

    const skipTests = mode === "aggressive" && input.skipTests
    const testResult = skipTests
      ? ({
          ok: true,
          errors: [],
          ran: 0,
          failed: 0,
          failures: [],
          selection: "skipped" as const,
          skipped: true,
        } satisfies DebugEngine.TestResult & { skipped: boolean })
      : await runTests(commands.test, shadowHandle.path, row.affected_files, projectID, scope)
    if (!testResult.ok) {
      return abort("tests-failed", {
        typecheck: { ok: true, errors: [] },
        lint: { ok: true, errors: [] },
        tests: {
          ok: false,
          errors: testResult.errors,
          ran: testResult.ran,
          failed: testResult.failed,
          failures: testResult.failures,
          selection: testResult.selection,
        },
      })
    }

    // Step 8: decision gate reached successful end. Phase 3 only
    // performs a real apply when an explicit patch was supplied.
    // Otherwise the pipeline has validated the plan against a clean
    // shadow — useful as a pre-flight — and returns applied: false
    // with a specific abortReason so callers can distinguish "no
    // patch" from an actual check failure.
    if (!input.patch) {
      return {
        applied: false,
        planId: input.planId,
        checks: {
          typecheck: { ok: true, errors: [] },
          lint: { ok: lintCheck.ok, errors: lintCheck.errors },
          tests: {
            ok: testResult.ok,
            errors: testResult.errors,
            ran: testResult.ran,
            failed: testResult.failed,
            failures: testResult.failures,
            selection: testResult.selection,
          },
        },
        filesChanged: [],
        rolledBack: false,
        abortReason: "no-patch-supplied",
        explain: DebugEngine.buildExplain("apply-safe-refactor", [], heuristics),
      }
    }

    // Step 9: real apply. We re-apply the patch to the actual worktree
    // via git apply. The shadow's job is now done; it's disposed in
    // the finally block. The git() util helper passes `stdin: "ignore"`,
    // so we can't use `git apply -`; write the patch to a temp file
    // and apply from there.
    const tmpPatch = path.join(Instance.worktree, ".dre-apply.patch")
    await fs.writeFile(tmpPatch, input.patch, "utf8")
    let realResult: Awaited<ReturnType<typeof git>>
    try {
      realResult = await git(["apply", "--whitespace=fix", tmpPatch], {
        cwd: Instance.worktree,
      })
    } finally {
      await fs.rm(tmpPatch, { force: true }).catch(() => undefined)
    }

    if (realResult.exitCode !== 0) {
      // Worktree is unchanged because git apply failed atomically.
      return abort("real-apply-failed", {
        typecheck: { ok: true, errors: [] },
        lint: { ok: lintCheck.ok, errors: lintCheck.errors },
        tests: {
          ok: testResult.ok,
          errors: testResult.errors,
          ran: testResult.ran,
          failed: testResult.failed,
          failures: testResult.failures,
          selection: testResult.selection,
        },
      })
    }

    DebugEngineQuery.updatePlanStatus(projectID, input.planId, "applied")
    heuristics.push("applied")

    // Compute files changed by inspecting the diff we just applied.
    // Simple grep of the patch — good enough for the audit trail.
    const filesChanged = extractFilesFromDiff(input.patch)

    return {
      applied: true,
      planId: input.planId,
      checks: {
        typecheck: { ok: true, errors: [] },
        lint: { ok: lintCheck.ok, errors: lintCheck.errors },
        tests: {
          ok: testResult.ok,
          errors: testResult.errors,
          ran: testResult.ran,
          failed: testResult.failed,
          failures: testResult.failures,
          selection: testResult.selection,
        },
      },
      filesChanged,
      rolledBack: false,
      abortReason: null,
      explain: DebugEngine.buildExplain("apply-safe-refactor", [], heuristics),
    }
  } finally {
    await shadowCleanup()
  }
}
