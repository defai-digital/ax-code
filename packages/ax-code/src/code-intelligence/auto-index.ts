import path from "path"
import { Log } from "../util/log"
import { Ripgrep } from "../file/ripgrep"
import { LANGUAGE_EXTENSIONS } from "../lsp/language"
import { Flag } from "../flag/flag"
import { CodeIntelligence } from "./index"
import { CodeGraphQuery } from "./query"
import { Instance } from "../project/instance"
import type { ProjectID } from "../project/schema"

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

  // Projects currently being auto-indexed. Keyed by project id as a
  // string (ProjectID is a branded string so `as string` is safe).
  // Process-lifetime — cleared on restart.
  const inFlight = new Set<string>()

  function isIndexable(file: string): boolean {
    const ext = path.extname(file)
    const lang = LANGUAGE_EXTENSIONS[ext]
    return lang !== undefined && lang !== "plaintext"
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
          return
        }

        log.info("indexing files", { projectID, fileCount: files.length })
        const result = await CodeIntelligence.indexFiles(projectID, files, 4)
        const elapsed = Date.now() - start
        log.info("background auto-index complete", {
          projectID,
          nodes: result.nodes,
          edges: result.edges,
          files: result.files,
          skipped: result.skipped,
          elapsedMs: elapsed,
        })
      } catch (err) {
        // Never crash the caller. An auto-index failure is a
        // missing-feature condition, not a fatal error — the
        // user can still run `ax-code index` manually, and the
        // sidebar will keep showing "graph not indexed · run
        // ax-code index" in the meantime.
        log.warn("background auto-index failed", {
          projectID,
          error: err instanceof Error ? err.message : String(err),
        })
      } finally {
        inFlight.delete(key)
      }
    })()
  }
}
