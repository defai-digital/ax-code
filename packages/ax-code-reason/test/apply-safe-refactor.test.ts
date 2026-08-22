import { afterEach, beforeEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { applySafeRefactorImpl } from "../src/apply-safe-refactor"
import { DebugEngineQuery } from "../src/query"
import { RefactorPlanID } from "../src/id"
import { sha256Hex } from "../src/quality/digest"
import type { PlanInsert } from "../src/repository"
import { installTestHost } from "./fixture/host"

// Phase 3 (D5): precondition drift detection. applySafeRefactor must refuse a
// plan whose affected files or source state changed since planning, marking it
// stale BEFORE opening a shadow worktree. The drift check runs ahead of the
// git/vcs gate, so these tests use a non-git host and never touch a real repo.

describe("applySafeRefactor precondition drift", () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ax-reason-drift-"))
    installTestHost({ vcs: "none", worktreeRoot: dir })
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  })

  function seedPlan(id: string, preconditions: PlanInsert["preconditions"], status: PlanInsert["status"] = "pending") {
    DebugEngineQuery.insertPlan({
      id: RefactorPlanID.make(id),
      project_id: "test-project",
      kind: "other",
      summary: `plan ${id}`,
      edits: [],
      affected_files: [],
      affected_symbols: [],
      risk: "low",
      status,
      graph_cursor_at_creation: null,
      preconditions,
      edit_groups: [],
      verification_plan: [],
      time_created: 1000,
    })
  }

  test("a changed affected file marks the plan stale before any shadow work", async () => {
    const file = path.join(dir, "target.ts")
    await fs.writeFile(file, "original\n")

    seedPlan("rpl_drift", {
      sourceState: null,
      affectedFileDigests: { [file]: sha256Hex("something-else\n") },
    })

    const result = await applySafeRefactorImpl("test-project", { planId: RefactorPlanID.make("rpl_drift") })

    expect(result.applied).toBe(false)
    expect(result.abortReason).toBe(`plan-stale:file-changed:${file}`)
    expect(result.explain.heuristicsApplied).toContain(`precondition-drift:file-changed:${file}`)
    expect(DebugEngineQuery.getPlan("test-project", RefactorPlanID.make("rpl_drift"))?.status).toBe("stale")
  })

  test("a deleted affected file marks the plan stale", async () => {
    const missing = path.join(dir, "gone.ts")
    seedPlan("rpl_missing", { sourceState: null, affectedFileDigests: { [missing]: sha256Hex("was-here\n") } })

    const result = await applySafeRefactorImpl("test-project", { planId: RefactorPlanID.make("rpl_missing") })
    expect(result.abortReason).toBe(`plan-stale:file-missing:${missing}`)
    expect(DebugEngineQuery.getPlan("test-project", RefactorPlanID.make("rpl_missing"))?.status).toBe("stale")
  })

  test("a moved source commit marks the plan stale", async () => {
    // Preconditions captured against commit "c1"; host now reports "c2".
    installTestHost({
      vcs: "none",
      sourceState: () => ({ available: true, commit: "c2", dirtyDigest: "d1" }),
    })

    seedPlan("rpl_source", {
      sourceState: { available: true, commit: "c1", dirtyDigest: "d1" },
      affectedFileDigests: {},
    })

    const result = await applySafeRefactorImpl("test-project", { planId: RefactorPlanID.make("rpl_source") })
    expect(result.abortReason).toBe("plan-stale:source-commit-moved")
    expect(DebugEngineQuery.getPlan("test-project", RefactorPlanID.make("rpl_source"))?.status).toBe("stale")
  })

  test("matching preconditions proceed past drift (to the not-git gate)", async () => {
    const file = path.join(dir, "stable.ts")
    await fs.writeFile(file, "unchanged\n")

    // Install a host whose sourceState matches the preconditions BEFORE
    // seeding — installTestHost swaps the singleton and resets the stores.
    installTestHost({
      vcs: "none",
      sourceState: () => ({ available: true, commit: "c1", dirtyDigest: "d1" }),
    })
    seedPlan("rpl_clean", {
      sourceState: { available: true, commit: "c1", dirtyDigest: "d1" },
      affectedFileDigests: { [file]: sha256Hex("unchanged\n") },
    })

    // Drift passes; the pipeline proceeds to the vcs gate and reports not-git.
    const result = await applySafeRefactorImpl("test-project", { planId: RefactorPlanID.make("rpl_clean") })
    expect(result.abortReason).toBe("not-a-git-worktree")
    // Plan remains pending — drift did not fire.
    expect(DebugEngineQuery.getPlan("test-project", RefactorPlanID.make("rpl_clean"))?.status).toBe("pending")
  })
})
