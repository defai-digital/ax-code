import { Wildcard } from "@/util/wildcard"
import { Log } from "@/util/log"
import { NamedError } from "@ax-code/util/error"
import z from "zod"
import {
  AUTONOMOUS_MAX_STEPS,
  AUTONOMOUS_MAX_FILES_CHANGED,
  AUTONOMOUS_MAX_LINES_CHANGED,
  AUTONOMOUS_BLOCKED_PATHS,
  AUTONOMOUS_PER_TOOL_MAX_CALLS,
} from "@/constants/session"
import { Recorder } from "@/replay/recorder"
import type { SessionID } from "./schema"

export namespace BlastRadius {
  const log = Log.create({ service: "session.blast-radius" })

  export type Kind = "steps" | "files" | "lines" | "blocked_path" | "tool_calls"

  export interface Caps {
    steps: number
    files: number
    lines: number
    blockedPaths: readonly string[]
    /**
     * Per-tool call-count cap. A `0` or negative value disables the
     * cap for that tool. Tools not in the map are unrestricted.
     */
    perTool: Readonly<Record<string, number>>
  }

  export interface State {
    files: Set<string>
    lines: number
    steps: number
    /** Per-tool call counts for the per-tool cap (PRD v4.2.1 P2-3). */
    toolCalls: Map<string, number>
    /** Set when the most-recent assertWithinCaps overage was per-tool (so describe() can name the tool). */
    lastTripToolName?: string
    caps: Caps
  }

  const MAX_SESSIONS = 256
  const sessions = new Map<SessionID, State>()

  function defaultCaps(): Caps {
    return {
      steps: AUTONOMOUS_MAX_STEPS,
      files: AUTONOMOUS_MAX_FILES_CHANGED,
      lines: AUTONOMOUS_MAX_LINES_CHANGED,
      blockedPaths: AUTONOMOUS_BLOCKED_PATHS,
      perTool: AUTONOMOUS_PER_TOOL_MAX_CALLS,
    }
  }

  /**
   * Merge `overrides` onto `base`. The `perTool` map merges by key so a
   * user override of one tool (e.g. `{ bash: 0 }` to disable the bash
   * cap) does not erase the seeded defaults for `edit`, `write`, etc.
   * The `blockedPaths` array replaces — users overriding the path list
   * intentionally want a different list, not an extension.
   */
  function mergeCaps(base: Caps, overrides: Partial<Caps>): Caps {
    return {
      ...base,
      ...overrides,
      perTool: overrides.perTool ? { ...base.perTool, ...overrides.perTool } : base.perTool,
      blockedPaths: overrides.blockedPaths ?? base.blockedPaths,
    }
  }

  /** Returns the active state, creating it on first use. */
  export function get(sessionID: SessionID, overrides?: Partial<Caps>): State {
    let state = sessions.get(sessionID)
    if (!state) {
      while (sessions.size >= MAX_SESSIONS) {
        const oldest = sessions.keys().next().value
        if (!oldest) break
        sessions.delete(oldest)
      }
      const caps = mergeCaps(defaultCaps(), overrides ?? {})
      state = { files: new Set(), lines: 0, steps: 0, toolCalls: new Map(), caps }
      sessions.set(sessionID, state)
      return state
    }
    sessions.delete(sessionID)
    sessions.set(sessionID, state)
    if (overrides) {
      state.caps = mergeCaps(state.caps, overrides)
    }
    return state
  }

  export function reset(sessionID: SessionID) {
    sessions.delete(sessionID)
  }

  /**
   * Clear per-tool call counters at turn boundaries so a long autonomous
   * session does not falsely trip the perTool cap because the caller has
   * legitimately used the same tool many times across separate turns.
   * Cumulative counters (steps / files / lines) intentionally persist —
   * they represent total session blast radius and are bounded by their
   * own caps.
   */
  export function resetToolCalls(sessionID: SessionID) {
    const state = sessions.get(sessionID)
    if (!state) return
    state.toolCalls.clear()
    state.lastTripToolName = undefined
  }

  /** Increment step count and return the new value. */
  export function incrementStep(sessionID: SessionID): number {
    const state = get(sessionID)
    state.steps += 1
    return state.steps
  }

  /**
   * Increment the per-tool call count for `toolName` and return the new value.
   * Use together with `assertWithinCaps` to honor `caps.perTool`.
   */
  export function incrementToolCall(sessionID: SessionID, toolName: string): number {
    const state = get(sessionID)
    const next = (state.toolCalls.get(toolName) ?? 0) + 1
    state.toolCalls.set(toolName, next)
    return next
  }

  /** Record a file write (idempotent for the same path) and a line delta. */
  export function recordWrite(sessionID: SessionID, filePath: string, lineDelta: number) {
    const state = get(sessionID)
    state.files.add(filePath)
    state.lines += Math.max(0, lineDelta)
  }

  /**
   * Test whether a path is blocked by the configured glob list.
   * Pattern matching uses `Wildcard.match`, where `*` becomes regex `.*`,
   * so both `*` and `**` patterns match nested segments.
   */
  export function isPathBlocked(sessionID: SessionID, filePath: string): { blocked: boolean; pattern?: string } {
    const state = get(sessionID)
    for (const pattern of state.caps.blockedPaths) {
      if (Wildcard.match(filePath, pattern)) return { blocked: true, pattern }
    }
    return { blocked: false }
  }

  /**
   * Check whether the next operation would exceed any cap. Returns a
   * descriptor when the cap is exceeded; null otherwise. Callers should
   * throw `LimitExceededError` (or a tool-shaped Error for blocked paths
   * so the model can recover).
   */
  export function checkAfterIncrement(sessionID: SessionID): { kind: Kind; current: number; limit: number } | null {
    const state = get(sessionID)
    if (state.steps > state.caps.steps) return { kind: "steps", current: state.steps, limit: state.caps.steps }
    if (state.files.size > state.caps.files)
      return { kind: "files", current: state.files.size, limit: state.caps.files }
    if (state.lines > state.caps.lines) return { kind: "lines", current: state.lines, limit: state.caps.lines }
    // Per-tool caps: any tool whose count exceeds its configured limit.
    // A 0 or negative configured limit disables the cap for that tool.
    state.lastTripToolName = undefined
    for (const [tool, count] of state.toolCalls) {
      const limit = state.caps.perTool[tool]
      if (typeof limit === "number" && limit > 0 && count > limit) {
        state.lastTripToolName = tool
        return { kind: "tool_calls", current: count, limit }
      }
    }
    return null
  }

  export const LimitExceededError = NamedError.create(
    "AutonomousLimitExceededError",
    z.object({
      kind: z.enum(["steps", "files", "lines", "blocked_path", "tool_calls"]),
      current: z.number(),
      limit: z.number(),
      message: z.string(),
    }),
  )

  /** Pretty error message for a tripped cap. */
  export function describe(check: { kind: Kind; current: number; limit: number }, toolName?: string): string {
    switch (check.kind) {
      case "steps":
        return `Autonomous step cap reached: ${check.current}/${check.limit}. The session will stop. Set experimental.autonomous_caps.steps to raise this limit.`
      case "files":
        return `Autonomous file-change cap reached: ${check.current}/${check.limit} files modified. Set experimental.autonomous_caps.files to raise.`
      case "lines":
        return `Autonomous line-change cap reached: ${check.current}/${check.limit} lines modified. Set experimental.autonomous_caps.lines to raise.`
      case "blocked_path":
        return `Path is on the autonomous blocked-path list (limit ${check.limit}).`
      case "tool_calls":
        return `Autonomous per-tool call cap reached for "${toolName ?? "<unknown>"}": ${check.current}/${check.limit} calls. Set experimental.autonomous_caps.perTool["${toolName ?? "<tool>"}"] to raise (use 0 to disable).`
    }
  }

  /** Throw if the session has just exceeded a cap. No-op on first overage already returned by check. */
  export function assertWithinCaps(sessionID: SessionID) {
    const check = checkAfterIncrement(sessionID)
    if (!check) return
    const state = sessions.get(sessionID)
    const toolName = check.kind === "tool_calls" ? state?.lastTripToolName : undefined
    log.warn("autonomous cap exceeded", { ...check, toolName })
    const message = describe(check, toolName)
    Recorder.emit({
      type: "autonomous.cap_hit",
      sessionID,
      kind: check.kind,
      current: check.current,
      limit: check.limit,
      message,
    })
    throw new LimitExceededError({
      kind: check.kind,
      current: check.current,
      limit: check.limit,
      message,
    })
  }

  /**
   * Tool-side guard called from edit/write/apply_patch BEFORE the write.
   * Only enforces in autonomous mode. Throws a regular Error (not the
   * NamedError) so the model sees the message and can recover by writing
   * a different path, instead of the session terminating.
   */
  export function assertWritable(sessionID: SessionID, filePath: string) {
    if (process.env["AX_CODE_AUTONOMOUS"] !== "true") return
    const result = isPathBlocked(sessionID, filePath)
    if (result.blocked) {
      const message =
        `Refusing to write ${filePath}: matches autonomous blocked-path pattern "${result.pattern}". ` +
        `Adjust experimental.autonomous_caps.blockedPaths to allow.`
      // current/limit are not meaningful for blocked_path — the
      // information that matters is the pattern, which is captured in
      // `message`. The schema requires both fields as int; emit 0/0
      // rather than the misleading "patterns count" so consumers don't
      // mistake it for a numeric threshold.
      Recorder.emit({
        type: "autonomous.cap_hit",
        sessionID,
        kind: "blocked_path",
        current: 0,
        limit: 0,
        message,
      })
      throw new Error(message)
    }
  }

  /**
   * Tool-side hook called AFTER a successful write to update the per-session
   * tally. Only counts in autonomous mode. Throws if the post-write tally
   * exceeds the file or line cap.
   */
  export function recordWriteAndAssert(sessionID: SessionID, filePath: string, lineDelta: number) {
    if (process.env["AX_CODE_AUTONOMOUS"] !== "true") return
    recordWrite(sessionID, filePath, lineDelta)
    assertWithinCaps(sessionID)
  }
}
