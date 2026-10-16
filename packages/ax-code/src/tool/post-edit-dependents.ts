// ADR-217: optional post-edit dependents notice for edit, write, and
// apply_patch. Behind code_intelligence.post_edit_dependents (default
// false) the tool output gains up to 5 files that import the edited
// file(s), taken from the code graph. Best-effort by contract: silent
// when the graph is not fresh, when nothing unreported remains, or when
// the lookup fails or exceeds its budget — it never blocks or fails an
// edit.

import { CodeIntelligence } from "../code-intelligence"
import type { ProjectID } from "../project/schema"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Log } from "../util/log"

const log = Log.create({ service: "tool.post-edit-dependents" })

// Wall-clock budget covering the freshness gate and the dependents lookup.
const BUDGET_MS = 200
const MAX_DEPENDENTS_IN_OUTPUT = 5
// Bound the session-dedupe table. Sessions are ephemeral; a long-lived
// server process resets the table instead of growing it without limit.
const MAX_TRACKED_SESSIONS = 256

/**
 * Read-only graph access used by the notice. Injectable so tests can
 * exercise the notice without a real graph; the default implementation
 * only issues queries and never triggers indexing.
 */
export type DependentsGraphAccess = {
  /** True only when the graph completed a full index (cursor present). */
  fresh(projectID: string): boolean | Promise<boolean>
  /** Files that import from `file`, scoped to the worktree. */
  dependents(projectID: string, file: string): string[] | Promise<string[]>
}

// Session-scoped dedupe: a dependent file is listed at most once per
// session (ADR-217), across every edit of that session.
const reportedBySession = new Map<string, Set<string>>()

/** Test hook: clear the session dedupe state. */
export function __resetPostEditDependentsForTests(): void {
  reportedBySession.clear()
}

const defaultGraph: DependentsGraphAccess = {
  fresh(projectID) {
    // `revision` is non-null only when code_index_cursor exists — i.e. a
    // full index batch completed (see CodeIntelligence.status). A missing
    // cursor means unindexed or interrupted; skip rather than answer from
    // a partial graph.
    return CodeIntelligence.status(projectID as ProjectID).revision !== null
  },
  dependents(projectID, file) {
    return CodeIntelligence.findDependents(projectID as ProjectID, file, { scope: "worktree" })
  },
}

/**
 * Render the dependents block for one edited file. Returns "" unless the
 * flag is on, the graph is fresh, and at least one not-yet-reported
 * dependent exists. Never throws.
 */
export async function postEditDependentsNotice(args: {
  projectID: string
  sessionID: string
  file: string
  enabled: boolean
  graph?: DependentsGraphAccess
}): Promise<string> {
  return collectNotice({ ...args, files: [args.file] })
}

/**
 * Convenience wrapper for tool call sites: reads the flag and project
 * context, then appends the notice to `output`. Every failure is
 * swallowed — the returned string is always usable as tool output.
 */
export async function appendPostEditDependentsNotice(
  output: string,
  ctx: { sessionID: string },
  file: string | string[],
  graph?: DependentsGraphAccess,
): Promise<string> {
  try {
    const enabled = (await Config.get()).code_intelligence?.post_edit_dependents === true
    if (!enabled) return output
    return (
      output +
      (await collectNotice({
        projectID: Instance.project.id,
        sessionID: ctx.sessionID,
        files: Array.isArray(file) ? file : [file],
        enabled: true,
        graph,
      }))
    )
  } catch (error) {
    log.warn("post-edit dependents notice skipped", { error })
    return output
  }
}

type CollectArgs = {
  projectID: string
  sessionID: string
  files: string[]
  enabled: boolean
  graph?: DependentsGraphAccess
}

async function collectNotice(args: CollectArgs): Promise<string> {
  if (!args.enabled || args.files.length === 0) return ""
  try {
    const deadline = AbortSignal.timeout(BUDGET_MS)
    const collected = (async () => {
      const graph = args.graph ?? defaultGraph
      if (!(await graph.fresh(args.projectID))) return []
      const dependents = new Set<string>()
      for (const file of args.files) {
        if (deadline.aborted) break
        for (const dependent of await graph.dependents(args.projectID, file)) dependents.add(dependent)
      }
      return [...dependents]
    })().catch((error) => {
      log.warn("post-edit dependents lookup failed", { error })
      return []
    })
    const outcome = await Promise.race([
      collected,
      new Promise<"timeout">((resolve) => deadline.addEventListener("abort", () => resolve("timeout"), { once: true })),
    ])
    if (outcome === "timeout") return ""
    const reported = filterUnreported(args.sessionID, args.files, outcome)
    if (reported.length === 0) return ""
    return render(args.files, reported)
  } catch (error) {
    log.warn("post-edit dependents notice failed", { error })
    return ""
  }
}

function filterUnreported(sessionID: string, editedFiles: string[], dependents: string[]): string[] {
  const edited = new Set(editedFiles)
  let seen = reportedBySession.get(sessionID)
  if (!seen) {
    if (reportedBySession.size >= MAX_TRACKED_SESSIONS) reportedBySession.clear()
    seen = new Set()
    reportedBySession.set(sessionID, seen)
  }
  const fresh: string[] = []
  for (const dependent of dependents) {
    if (edited.has(dependent) || seen.has(dependent)) continue
    seen.add(dependent)
    fresh.push(dependent)
    if (fresh.length >= MAX_DEPENDENTS_IN_OUTPUT) break
  }
  return fresh
}

function render(editedFiles: string[], dependents: string[]): string {
  const lines = dependents.map((dependent) => `- ${dependent}`)
  return `\n\nFiles that import ${editedFiles.join(", ")} (from the code graph; cross-check with tools before relying on it):\n${lines.join("\n")}`
}
