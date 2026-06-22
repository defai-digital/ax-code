import { Log } from "../util/log"
import { LSP } from "../lsp"
import type { DebugEngine } from "./index"

// prewarm-lsp — Impact-driven LSP client prewarming.
//
// After analyzeImpact computes the affected file set, proactively warm the
// LSP clients for those files so the next collectDiagnostics call gets fresh
// results without cold-start latency (spawning a language server or opening
// a file for the first time can take 1-5 seconds per file).
//
// The prewarm is best-effort: individual touch failures are logged and
// swallowed so a broken language server for one file type never blocks
// prewarming of other file types.

const log = Log.create({ service: "debug-engine.prewarm" })

// Maximum files to prewarm in a single call. Beyond this the LSP client
// pool can get overwhelmed — each touch triggers didOpen + incremental
// sync which is I/O-heavy.
const MAX_PREWARM_FILES = 50

// Minimum interval between prewarm runs for the same file. Prevents
// redundant touch calls when multiple edits happen in quick succession.
const MIN_PREWARM_INTERVAL_MS = 5_000
const lastPrewarmAt = new Map<string, number>()

/**
 * Prewarm LSP clients for files in an impact report. Call this after
 * analyzeImpact returns so the next diagnostics collection is fast.
 *
 * Returns the number of files successfully warmed.
 */
export async function prewarmAffectedFiles(impactReport: DebugEngine.ImpactReport): Promise<number> {
  const files = impactReport.affectedFiles.slice(0, MAX_PREWARM_FILES)
  if (files.length === 0) return 0

  const now = Date.now()
  const eligibleFiles = files.filter((file) => {
    const lastTime = lastPrewarmAt.get(file)
    if (lastTime && now - lastTime < MIN_PREWARM_INTERVAL_MS) return false
    return true
  })

  if (eligibleFiles.length === 0) {
    log.debug("all files recently prewarmed, skipping", { total: files.length })
    return 0
  }

  const results = await Promise.allSettled(
    eligibleFiles.map(async (file) => {
      await LSP.touchFile(file, false)
      lastPrewarmAt.set(file, now)
    }),
  )

  let warmed = 0
  let failed = 0
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "fulfilled") {
      warmed++
    } else {
      failed++
      log.warn("prewarm failed", {
        file: eligibleFiles[i],
        error: (results[i] as PromiseRejectedResult).reason,
      })
    }
  }

  log.info("prewarm complete", {
    warmed,
    failed,
    skipped: files.length - eligibleFiles.length,
    total: impactReport.affectedFiles.length,
  })

  return warmed
}

/**
 * Clear the prewarm rate-limit tracking. Test helper.
 */
export function __clearPrewarmState(): void {
  lastPrewarmAt.clear()
}
