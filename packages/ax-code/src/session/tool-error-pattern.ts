/**
 * ToolErrorPatternTracker — detects repeated tool error patterns within a
 * session and returns proactive guidance when the same error recurs 3+ times.
 *
 * Unlike SelfCorrection (which generates reflection prompts for individual
 * failures), this tracker identifies systemic patterns: the LLM keeps making
 * the same mistake across multiple turns. When the threshold is reached, it
 * returns a guidance string to append to the next tool result.
 *
 * Integration: call `record()` on every tool error and `guidance()` before
 * persisting the tool-error part. Call `reset()` on compaction.
 */

import { Log } from "../util/log"

export namespace ToolErrorPatternTracker {
  const log = Log.create({ service: "tool-error-pattern" })
  const THRESHOLD = 3
  const MAX_SESSIONS = 256

  /** Normalized error category for pattern matching. Strips numeric tokens
   *  and file-specific details so that similar errors share a bucket. */
  function errorCategory(toolName: string, errorMessage: string): string {
    const msg = errorMessage.replace(/[0-9]+/g, "N").slice(0, 200)
    // Classify common error patterns (tool-specific where needed)
    if (toolName === "edit" && /could not find.*oldString/i.test(msg)) return "edit:oldStringNotFound"
    if ((toolName === "bash" || toolName === "read") && (/file.*not found/i.test(msg) || /ENOENT/i.test(msg)))
      return "bash:fileNotFound"
    if (
      (toolName === "bash" || toolName === "cd") &&
      (/directory.*not exist/i.test(msg) || /ENOENT.*directory/i.test(msg))
    )
      return "bash:dirNotFound"
    if (/permission denied/i.test(msg) || /EACCES/i.test(msg)) return "permission:denied"
    if (toolName === "bash" && /timeout/i.test(msg)) return "bash:timeout"
    if (toolName === "bash" && /exit code/i.test(msg)) return "bash:nonZeroExit"
    if (/typecheck/i.test(msg)) return "verify:typecheckFailed"
    if (/test.*fail/i.test(msg)) return "verify:testFailed"
    if (/lint/i.test(msg)) return "verify:lintFailed"
    // Generic: bucket by tool + first 80 chars of normalized message
    return `${toolName}:${msg.slice(0, 80)}`
  }

  interface PatternEntry {
    count: number
    firstSeen: number
    lastSeen: number
    lastError: string
    filePaths: Set<string>
  }

  interface SessionPatterns {
    patterns: Map<string, PatternEntry>
  }

  // LRU-capped session map (same pattern as SelfCorrection)
  const sessions = new Map<string, SessionPatterns>()

  function touch(sessionID: string) {
    const entry = sessions.get(sessionID)
    if (entry) {
      sessions.delete(sessionID)
      sessions.set(sessionID, entry)
    }
    while (sessions.size > MAX_SESSIONS) {
      const oldest = sessions.keys().next().value
      if (oldest === undefined) break
      sessions.delete(oldest)
    }
  }

  function forSession(sessionID: string): SessionPatterns {
    let s = sessions.get(sessionID)
    if (!s) {
      s = { patterns: new Map() }
      sessions.set(sessionID, s)
    }
    touch(sessionID)
    return s
  }

  /** Record a tool error. Returns the current occurrence count for this pattern. */
  export function record(sessionID: string, toolName: string, errorMessage: string, filePath?: string): number {
    const s = forSession(sessionID)
    const category = errorCategory(toolName, errorMessage)
    const entry = s.patterns.get(category) ?? {
      count: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      lastError: "",
      filePaths: new Set(),
    }
    entry.count++
    entry.lastSeen = Date.now()
    entry.lastError = errorMessage.slice(0, 500)
    if (filePath) entry.filePaths.add(filePath)
    s.patterns.set(category, entry)

    if (entry.count === THRESHOLD) {
      log.info("error pattern threshold reached", {
        sessionID,
        category,
        count: entry.count,
        files: [...entry.filePaths].slice(0, 5),
      })
    }

    return entry.count
  }

  export function filePathFromInput(input: unknown): string | undefined {
    if (!input || typeof input !== "object") return undefined
    const record = input as Record<string, unknown>
    for (const key of ["filePath", "filepath", "file_path", "path"]) {
      const value = record[key]
      if (typeof value === "string" && value.length > 0) return value
    }
    const edits = record["edits"]
    if (Array.isArray(edits)) {
      for (const edit of edits) {
        const filePath = filePathFromInput(edit)
        if (filePath) return filePath
      }
    }
    return undefined
  }

  /** Return proactive guidance if the current error pattern has recurred
   *  THRESHOLD or more times. Returns null otherwise. */
  export function guidance(sessionID: string, toolName: string, errorMessage: string): string | null {
    const s = sessions.get(sessionID)
    if (!s) return null
    const category = errorCategory(toolName, errorMessage)
    const entry = s.patterns.get(category)
    if (!entry || entry.count < THRESHOLD) return null

    // Build guidance based on error category
    const files = [...entry.filePaths]
    const fileHint = files.length > 0 ? ` (affected files: ${files.slice(0, 3).join(", ")})` : ""

    const categoryGuidance = categoryGuidanceFor(category, entry)
    if (categoryGuidance) return categoryGuidance

    // Generic guidance for uncategorized patterns
    return (
      `<system-reminder>\n` +
      `You have encountered the same ${toolName} error ${entry.count} times in this session${fileHint}. ` +
      `Consider a different approach: read the relevant files first, verify your assumptions, ` +
      `and break the task into smaller steps before retrying.\n` +
      `</system-reminder>`
    )
  }

  /** Category-specific guidance for known error patterns. */
  function categoryGuidanceFor(category: string, entry: PatternEntry): string | null {
    const files = [...entry.filePaths]
    const fileHint = files.length > 0 ? ` in ${files[0]}` : ""

    switch (category) {
      case "edit:oldStringNotFound":
        return (
          `<system-reminder>\n` +
          `Your edit has failed ${entry.count} times because oldString was not found${fileHint}. ` +
          `This usually means: (1) you haven't read the file recently and its content has changed, ` +
          `(2) your oldString has whitespace/indentation differences from the actual file, or ` +
          `(3) the text you want to replace doesn't exist at all. ` +
          `Read the file first with the Read tool, then copy the exact text you want to replace.\n` +
          `</system-reminder>`
        )
      case "bash:fileNotFound":
      case "bash:dirNotFound":
        return (
          `<system-reminder>\n` +
          `Your bash command has failed ${entry.count} times because a path does not exist. ` +
          `Use the Glob tool to discover available files, or use ls to verify the path before running commands.\n` +
          `</system-reminder>`
        )
      case "verify:typecheckFailed":
        return (
          `<system-reminder>\n` +
          `Typecheck has failed ${entry.count} times. Instead of making more edits, read the type error output carefully ` +
          `and fix one type error at a time. Consider whether your changes introduced a type mismatch or whether ` +
          `the existing code has a pre-existing type issue.\n` +
          `</system-reminder>`
        )
      case "verify:testFailed":
        return (
          `<system-reminder>\n` +
          `Tests have failed ${entry.count} times. Read the test output carefully and fix one failure at a time. ` +
          `If you're unsure why a test fails, read the test file and the code under test before making more changes.\n` +
          `</system-reminder>`
        )
      default:
        return null
    }
  }

  /** Record a successful tool execution to reset the pattern count. */
  export function recordSuccess(sessionID: string, toolName: string) {
    const s = sessions.get(sessionID)
    if (!s) return
    const prefix = `${toolName}:`
    for (const [k] of s.patterns) {
      if (k.startsWith(prefix)) s.patterns.delete(k)
    }
  }

  /** Reset all pattern tracking for a session (called on compaction). */
  export function reset(sessionID: string) {
    sessions.delete(sessionID)
  }

  /** Reset all sessions (called on process shutdown or test cleanup). */
  export function resetAll() {
    sessions.clear()
  }

  /** Get statistics for debugging. */
  export function stats(sessionID?: string) {
    const sources =
      sessionID === undefined ? Array.from(sessions.values()) : [sessions.get(sessionID) ?? { patterns: new Map() }]
    let totalPatterns = 0
    let totalOccurrences = 0
    let thresholdCrossed = 0
    for (const s of sources) {
      totalPatterns += s.patterns.size
      for (const entry of s.patterns.values()) {
        totalOccurrences += entry.count
        if (entry.count >= THRESHOLD) thresholdCrossed++
      }
    }
    return { totalPatterns, totalOccurrences, thresholdCrossed }
  }
}
