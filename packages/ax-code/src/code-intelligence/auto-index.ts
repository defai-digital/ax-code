import path from "path"
import z from "zod"
import { Log } from "../util/log"
import { Ripgrep } from "../file/ripgrep"
import { LANGUAGE_EXTENSIONS } from "../lsp/language"
import { Flag } from "../flag/flag"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { CodeIntelligence } from "./index"
import { CodeGraphBuilder } from "./builder"
import { CodeGraphQuery } from "./query"
import { Instance } from "../project/instance"
import type { ProjectID } from "../project/schema"
import { NativeAddon } from "../native/addon"

// Auto-index: fires a background code-intelligence index when a
// session starts against an empty or missing graph, so users don't
// need to run `ax-code index` manually before DRE tools produce
// useful results.
//
// Design decisions:
//
// 1. Empty-graph trigger only (v2.3.9). We fire when the live
//    node count for the project is zero. Stale-graph detection
//    (comparing commit SHA to code_index_cursor.commit_sha) is a
//    legitimate follow-up but adds real complexity because a
//    "stale" index on a 10k-file project still reflects most of
//    the truth, and re-indexing from scratch every time a branch
//    switches would be disproportionate. The CodeGraphWatcher
//    already handles per-file updates on save via LSP didChange
//    events — auto-index is specifically for the "brand new
//    project, graph is empty" bootstrap case.
//
// 2. Fire-and-forget. maybeStart() is a synchronous function that
//    kicks off a background Promise and returns immediately. The
//    caller never awaits it. Errors are logged and swallowed so a
//    failed index never takes down the session it was triggered
//    from.
//
// 3. Per-project in-flight gate. An in-module Set tracks projects
//    currently being auto-indexed. A second call for the same
//    project while one is running is a no-op. The set is process-
//    lifetime — if ax-code restarts mid-index, the next session
//    will see the partially-populated graph (node count > 0) and
//    not re-trigger, which is the right behavior: the existing
//    watcher will catch up any remaining files incrementally.
//
// 4. Opt-out via AX_CODE_DISABLE_AUTO_INDEX. Users who want
//    explicit control (large projects, CI, debugging the indexer)
//    set the env var and auto-index becomes a no-op. The manual
//    `ax-code index` command still works the same way.
//
// 5. Respects AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE. When the
//    code intelligence flag is off, auto-index is unreachable
//    because the caller in session/prompt.ts already gates on
//    that flag — but we double-check here as defense in depth.

export namespace AutoIndex {
  const log = Log.create({ service: "code-intelligence.auto-index" })

  // Bus events. Defined here instead of in a shared module because
  // auto-index is the only emitter right now (and the manual CLI
  // command, which imports this namespace). Subscribers live in the
  // server's /debug-engine/pending-plans endpoint and in the TUI's
  // sync layer.
  export const Event = {
    Progress: BusEvent.define(
      "code.index.progress",
      z.object({
        projectID: z.string(),
        completed: z.number(),
        total: z.number(),
      }),
    ),
    State: BusEvent.define(
      "code.index.state",
      z.object({
        projectID: z.string(),
        state: z.union([z.literal("idle"), z.literal("indexing"), z.literal("failed")]),
        error: z.string().optional(),
      }),
    ),
  }

  // Observable per-project indexing state. Both auto-index and the
  // manual `ax-code index` command write here so the TUI sidebar can
  // render a single, consistent "indexing in progress" / "indexing
  // failed" signal regardless of which code path triggered it.
  //
  // Keyed by project id string. Process-lifetime — restarting ax-code
  // resets all entries to implicit "idle" (absent entry).
  export type IndexState = {
    state: "idle" | "indexing" | "failed"
    completed: number
    total: number
    startedAt: number | null
    finishedAt: number | null
    error: string | null
  }

  const stateByProject = new Map<string, IndexState>()
  const MAX_STATE_ENTRIES = 64

  export function getState(projectID: ProjectID): IndexState {
    const key = projectID as unknown as string
    return (
      stateByProject.get(key) ?? {
        state: "idle",
        completed: 0,
        total: 0,
        startedAt: null,
        finishedAt: null,
        error: null,
      }
    )
  }

  // Helper used by both auto-index and the CLI command. Transitions
  // the project's state, updates counters, and publishes the
  // corresponding bus event so the TUI picks it up without waiting
  // on the 10s poll.
  export function setState(
    projectID: ProjectID,
    patch: Partial<IndexState> & { state: IndexState["state"] },
  ): void {
    const key = projectID as unknown as string
    const prev = getState(projectID)
    const next: IndexState = { ...prev, ...patch }
    stateByProject.set(key, next)
    // Cap the map to prevent unbounded growth in long-running
    // processes that open many projects. Evict the oldest idle
    // entry when the cap is exceeded (FIFO on insertion order).
    if (stateByProject.size > MAX_STATE_ENTRIES) {
      for (const [k, v] of stateByProject) {
        if (v.state === "idle") {
          stateByProject.delete(k)
          break
        }
      }
    }
    // Fire-and-forget: a publish failure on an observability event
    // must never affect the index run. Bus.publish already catches
    // subscriber errors internally.
    void Bus.publish(Event.State, {
      projectID: key,
      state: next.state,
      error: next.error ?? undefined,
    }).catch(() => {})
  }

  export function reportProgress(projectID: ProjectID, completed: number, total: number): void {
    const key = projectID as unknown as string
    const prev = getState(projectID)
    stateByProject.set(key, { ...prev, completed, total })
    void Bus.publish(Event.Progress, { projectID: key, completed, total }).catch(() => {})
  }

  // Projects currently being auto-indexed. Keyed by project id as a
  // string (ProjectID is a branded string so `as string` is safe).
  // Process-lifetime — cleared on restart.
  const inFlight = new Set<string>()

  function isIndexable(file: string): boolean {
    const ext = path.extname(file)
    const lang = LANGUAGE_EXTENSIONS[ext]
    return lang !== undefined && lang !== "plaintext"
  }

  // Standalone release binaries do not ship the code-intelligence native
  // addon set. The pure TypeScript path is still valid for explicit/manual
  // indexing, but auto-starting it from the first prompt can monopolize the
  // worker long enough to feel like the UI hung. Keep auto-index opt-in to
  // environments where the native index core is actually present.
  function supportsAutomaticIndexing(): boolean {
    return NativeAddon.index() !== undefined
  }

  /**
   * Start a background auto-index for the given project if:
   *   - The code intelligence flag is on
   *   - AX_CODE_DISABLE_AUTO_INDEX is NOT set
   *   - The graph for this project currently has zero nodes
   *   - No auto-index is already running for this project
   *
   * Returns immediately — the actual indexing runs asynchronously
   * on a background Promise with all errors logged and swallowed.
   * Safe to call multiple times; duplicate calls are no-ops.
   */
  export function maybeStart(projectID: ProjectID): void {
    // Defense in depth — the session caller already gates on the
    // code intelligence flag, but auto-index has multiple call
    // sites planned for future releases and each should be safe
    // on its own.
    if (!Flag.AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE) return
    if (Flag.AX_CODE_DISABLE_AUTO_INDEX) return
    if (!supportsAutomaticIndexing()) {
      log.info("skipping: native index addon unavailable for automatic indexing", { projectID })
      return
    }

    const key = projectID as unknown as string
    if (inFlight.has(key)) {
      log.info("skipping: already in flight", { projectID })
      return
    }

    // Synchronous cheap live count. If the project has any nodes
    // at all, we assume a prior index run populated it and the
    // watcher will keep it fresh. This is intentionally generous
    // — we'd rather miss a stale index than re-index on every
    // session start.
    const currentNodes = CodeGraphQuery.countNodes(projectID)
    if (currentNodes > 0) {
      log.info("skipping: graph already populated", {
        projectID,
        nodeCount: currentNodes,
      })
      return
    }

    // Capture the instance directory snapshot for the background
    // task. The background Promise runs outside the Instance
    // context that called us, so we need the path explicitly.
    const directory = Instance.directory

    inFlight.add(key)
    log.info("starting background auto-index", { projectID, directory })

    // Fire and forget. Wrapped in an IIFE so we can use async/await
    // syntax while still returning from maybeStart synchronously.
    // Any error inside the Promise is caught and logged — auto-index
    // is best-effort, it never propagates failures to the caller.
    ;(async () => {
      const start = Date.now()
      setState(projectID, {
        state: "indexing",
        completed: 0,
        total: 0,
        startedAt: start,
        finishedAt: null,
        error: null,
      })
      try {
        // Walk eligible files via ripgrep (honors .gitignore),
        // filter to LSP-supported languages. Same logic as the
        // CLI command in cli/cmd/index-graph.ts, extracted here
        // so auto-index doesn't depend on CLI internals.
        const files: string[] = []
        for await (const rel of Ripgrep.files({ cwd: directory })) {
          const abs = path.join(directory, rel)
          if (!isIndexable(abs)) continue
          files.push(abs)
        }

        if (files.length === 0) {
          log.info("no indexable files found, skipping", { projectID, directory })
          setState(projectID, {
            state: "idle",
            completed: 0,
            total: 0,
            startedAt: start,
            finishedAt: Date.now(),
            error: null,
          })
          return
        }

        log.info("indexing files", { projectID, fileCount: files.length })
        reportProgress(projectID, 0, files.length)
        // `lock: "try"` — if another ax-code process (a second TUI,
        // an `ax-code index` in another terminal) already holds the
        // index lock, auto-index silently skips rather than queueing.
        // The other process will populate the graph and our next
        // session will see it via the empty-graph check.
        const result = await CodeIntelligence.indexFiles(projectID, files, {
          concurrency: 4,
          lock: "try",
          onProgress: (completed, total) => reportProgress(projectID, completed, total),
        })
        const elapsed = Date.now() - start
        log.info("background auto-index complete", {
          projectID,
          nodes: result.nodes,
          edges: result.edges,
          files: result.files,
          unchanged: result.unchanged,
          skipped: result.skipped,
          failed: result.failed,
          elapsedMs: elapsed,
        })
        setState(projectID, {
          state: "idle",
          completed: files.length,
          total: files.length,
          startedAt: start,
          finishedAt: Date.now(),
          error: null,
        })
      } catch (err) {
        // Never crash the caller. An auto-index failure is a
        // missing-feature condition, not a fatal error — the user
        // can still run `ax-code index` manually. The "failed"
        // state is surfaced to the TUI sidebar so the user sees a
        // concrete error instead of a silent "graph not indexed".
        //
        // LockHeldError is treated as benign: another process is
        // already indexing, so we return to "idle" without a
        // failure marker.
        if (err instanceof CodeGraphBuilder.LockHeldError) {
          log.info("auto-index skipped: another process holds the lock", { projectID })
          setState(projectID, {
            state: "idle",
            completed: 0,
            total: 0,
            startedAt: start,
            finishedAt: Date.now(),
            error: null,
          })
          return
        }
        log.warn("background auto-index failed", {
          projectID,
          error: err instanceof Error ? err.message : String(err),
        })
        setState(projectID, {
          state: "failed",
          startedAt: start,
          finishedAt: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        inFlight.delete(key)
      }
    })()
  }
}
