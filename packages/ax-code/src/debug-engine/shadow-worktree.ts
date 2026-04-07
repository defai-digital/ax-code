import fs from "fs/promises"
import path from "path"
import { git } from "../util/git"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import type { ProjectID } from "../project/schema"

// Shadow worktree helper for Safe Refactor Mode (ADR-007).
//
// Creates a scratch `git worktree` tied to the current Instance, runs
// validation inside it, and cleans up unconditionally. Used only by
// applySafeRefactor — not exposed to agents directly.
//
// Design decisions:
//   - `git worktree add` via the existing util/git helper. No direct
//     shell or Bun.$ usage.
//   - Shadow worktrees live under <instanceDir>/automatosx/tmp/dre-shadow/<planId>
//     per the CLAUDE.md rule. We deliberately put it inside the
//     instance directory rather than $TMPDIR so ignore patterns the
//     user already has for automatosx/tmp/ cover us.
//   - Branch name: ax-code/dre/shadow/<planId> with slashes preserved.
//     The branch is created fresh from HEAD so the shadow has a clean
//     checkpoint to reset to.
//   - Max 3 concurrent shadows per project. Over-cap callers block in
//     a simple FIFO queue rather than erroring.
//   - Symbol.asyncDispose on the returned handle: `await using shadow
//     = await ShadowWorktree.open(...)` guarantees cleanup on any
//     code path, including thrown exceptions.

const log = Log.create({ service: "debug-engine.shadow-worktree" })

const MAX_CONCURRENT_PER_PROJECT = 3

// Per-project concurrency gate. A tiny in-memory queue keyed by
// ProjectID so two parallel `applySafeRefactor` calls on the same
// project serialize if they'd exceed the cap. Cross-project calls
// don't interact.
const concurrencyGates = new Map<
  string,
  {
    inFlight: number
    waiters: Array<() => void>
  }
>()

async function acquireSlot(projectID: ProjectID): Promise<() => void> {
  const key = projectID as unknown as string
  let gate = concurrencyGates.get(key)
  if (!gate) {
    gate = { inFlight: 0, waiters: [] }
    concurrencyGates.set(key, gate)
  }
  if (gate.inFlight < MAX_CONCURRENT_PER_PROJECT) {
    gate.inFlight++
    return () => releaseSlot(projectID)
  }
  await new Promise<void>((resolve) => gate!.waiters.push(resolve))
  gate.inFlight++
  return () => releaseSlot(projectID)
}

function releaseSlot(projectID: ProjectID): void {
  const key = projectID as unknown as string
  const gate = concurrencyGates.get(key)
  if (!gate) return
  gate.inFlight--
  const waiter = gate.waiters.shift()
  if (waiter) {
    // The waiter's resolved microtask will increment inFlight.
    // Do NOT delete the gate here — the waiter still needs it.
    waiter()
    return
  }
  if (gate.inFlight === 0) concurrencyGates.delete(key)
}

export namespace ShadowWorktree {
  export type Handle = {
    /** Absolute path to the shadow worktree root. */
    readonly path: string
    /** Branch name used by the shadow. */
    readonly branch: string
    /** Identifier passed in at open time. Useful for logging. */
    readonly planId: string
    /** True once this handle has been disposed. */
    readonly disposed: boolean
    [Symbol.asyncDispose](): Promise<void>
  }

  export type OpenPreconditionFailure =
    | { ok: false; reason: "not-git" }
    | { ok: false; reason: "uncommitted-changes"; files: string[] }

  export type OpenResult =
    | { ok: true; handle: Handle }
    | OpenPreconditionFailure
    | { ok: false; reason: "create-failed"; detail: string }

  /**
   * Check whether the current Instance can host a shadow worktree. Runs
   * the same precondition checks `open` does but without creating
   * anything, so callers that want to surface "why not" to the user
   * can do it upfront.
   */
  export async function precheck(): Promise<{ ok: true } | OpenPreconditionFailure> {
    if (Instance.project.vcs !== "git") return { ok: false, reason: "not-git" }
    // --no-renames keeps the porcelain output in a single-path-per-line
    // format. Without it, renamed entries are `R  old -> new` and the
    // naive `slice(3)` leaks the old name into the reported file
    // list. We don't need rename detection here — we only want the
    // list of files with uncommitted changes.
    const status = await git(["status", "--porcelain", "--no-renames"], { cwd: Instance.worktree })
    if (status.exitCode !== 0) return { ok: false, reason: "not-git" }
    const text = status.text().trim()
    if (text.length > 0) {
      const files = text
        .split("\n")
        .map((line) => line.slice(3).trim())
        .filter(Boolean)
      return { ok: false, reason: "uncommitted-changes", files }
    }
    return { ok: true }
  }

  /**
   * Open a shadow worktree for the current Instance. Caller must
   * `await using` the returned handle or explicitly call
   * `handle[Symbol.asyncDispose]()` in a finally block. The shadow is
   * checked out on a fresh branch at the current HEAD so `git reset
   * --hard HEAD` inside it is a clean rollback.
   *
   * Concurrency-gated per project at MAX_CONCURRENT_PER_PROJECT (=3).
   * When the gate is saturated, additional callers await in FIFO
   * order — no errors, just backpressure.
   */
  export async function open(params: { planId: string; allowDirty?: boolean }): Promise<OpenResult> {
    const projectID = Instance.project.id

    // Preconditions first so we don't burn a concurrency slot on a
    // request that can never succeed.
    if (Instance.project.vcs !== "git") return { ok: false, reason: "not-git" }
    if (!params.allowDirty) {
      const pre = await precheck()
      if (pre.ok === false) return pre
    }

    const release = await acquireSlot(projectID)

    try {
      const worktreeRoot = Instance.worktree
      const shadowBase = path.join(Instance.directory, "automatosx", "tmp", "dre-shadow")
      await fs.mkdir(shadowBase, { recursive: true })
      const shadowPath = path.join(shadowBase, params.planId)
      const branch = `ax-code/dre/shadow/${params.planId}`

      // If a previous run left a stale directory, clear it before git
      // worktree add complains. This is safe because the shadow base
      // is DRE-owned and never holds user data.
      await fs.rm(shadowPath, { recursive: true, force: true }).catch(() => undefined)

      // Capture the commit SHA we're branching from so we can also
      // clean up the branch on dispose (git worktree remove alone
      // leaves the branch behind).
      const headSha = await git(["rev-parse", "HEAD"], { cwd: worktreeRoot })
      if (headSha.exitCode !== 0) {
        release()
        return { ok: false, reason: "create-failed", detail: "rev-parse HEAD failed" }
      }

      const add = await git(["worktree", "add", "-b", branch, shadowPath, "HEAD"], {
        cwd: worktreeRoot,
      })
      if (add.exitCode !== 0) {
        release()
        return {
          ok: false,
          reason: "create-failed",
          detail: add.stderr.toString().trim() || "git worktree add failed",
        }
      }

      log.info("shadow worktree opened", { planId: params.planId, path: shadowPath, branch })

      let disposed = false
      const handle: Handle = {
        path: shadowPath,
        branch,
        planId: params.planId,
        get disposed() {
          return disposed
        },
        async [Symbol.asyncDispose]() {
          if (disposed) return
          disposed = true
          try {
            // `git worktree remove --force` handles uncommitted changes
            // in the shadow. We *want* to discard any diff applied
            // inside it — the whole point is that a failed check leaves
            // nothing behind.
            const remove = await git(["worktree", "remove", "--force", shadowPath], {
              cwd: worktreeRoot,
            })
            if (remove.exitCode !== 0) {
              log.warn("shadow worktree remove failed", {
                planId: params.planId,
                stderr: remove.stderr.toString(),
              })
            }
            // Delete the branch git just created. Best-effort; if the
            // worktree remove partially succeeded the branch may still
            // be referenced.
            await git(["branch", "-D", branch], { cwd: worktreeRoot }).catch(() => undefined)
            // Belt-and-suspenders: physically remove the directory if
            // it survived.
            await fs.rm(shadowPath, { recursive: true, force: true }).catch(() => undefined)
          } finally {
            release()
            log.info("shadow worktree disposed", { planId: params.planId })
          }
        },
      }

      return { ok: true, handle }
    } catch (err) {
      release()
      return {
        ok: false,
        reason: "create-failed",
        detail: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Clean up orphan shadow worktrees and branches left behind by a
   * process crash between `open()` and `dispose()`. Safe to call at
   * any time — it only touches DRE-owned artifacts.
   *
   * Call this during startup or before a new shadow open to prevent
   * resource accumulation after crashes.
   */
  export async function cleanupOrphans(): Promise<{ branches: number; directories: number }> {
    if (Instance.project.vcs !== "git") return { branches: 0, directories: 0 }
    const cwd = Instance.worktree
    let branches = 0
    let directories = 0

    // Remove orphan DRE shadow branches
    const shadowBase = path.join(Instance.directory, "automatosx", "tmp", "dre-shadow")
    const branchList = await git(["branch", "--list", "ax-code/dre/shadow/*"], { cwd })
    if (branchList.exitCode === 0) {
      const names = branchList
        .text()
        .trim()
        .split("\n")
        .map((line) => line.trim().replace(/^\*\s*/, ""))
        .filter(Boolean)
      for (const name of names) {
        // Force-remove the worktree first (if it still exists), then the branch
        const planId = name.replace("ax-code/dre/shadow/", "")
        const worktreeDir = path.join(shadowBase, planId)
        await git(["worktree", "remove", "--force", worktreeDir], { cwd }).catch(() => undefined)
        const del = await git(["branch", "-D", name], { cwd })
        if (del.exitCode === 0) branches++
      }
    }

    // Remove orphan shadow directories
    const entries = await fs.readdir(shadowBase).catch(() => [] as string[])
    for (const entry of entries) {
      const full = path.join(shadowBase, entry)
      const stat = await fs.stat(full).catch(() => null)
      if (stat?.isDirectory()) {
        await fs.rm(full, { recursive: true, force: true }).catch(() => undefined)
        directories++
      }
    }

    if (branches > 0 || directories > 0) {
      log.info("cleaned up orphan shadows", { branches, directories })
    }
    return { branches, directories }
  }

  /**
   * Test helper: reset the concurrency gate state. Production code
   * never needs this — the gate is process-lifetime. Exposed so the
   * test suite can isolate concurrency tests from each other.
   */
  export function __resetGates(): void {
    concurrencyGates.clear()
  }
}
