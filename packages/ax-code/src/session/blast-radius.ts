import { Wildcard } from "@/util/wildcard"
import { Log } from "@/util/log"
import { NamedError } from "@ax-code/util/error"
import z from "zod"
import {
  AUTONOMOUS_MAX_STEPS,
  AUTONOMOUS_MAX_FILES_CHANGED,
  AUTONOMOUS_MAX_LINES_CHANGED,
  AUTONOMOUS_BLOCKED_PATHS,
} from "@/constants/session"
import { Recorder } from "@/replay/recorder"
import type { SessionID } from "./schema"

export namespace BlastRadius {
  const log = Log.create({ service: "session.blast-radius" })

  export type Kind = "steps" | "files" | "lines" | "blocked_path"

  export interface Caps {
    steps: number
    files: number
    lines: number
    blockedPaths: readonly string[]
  }

  export interface State {
    files: Set<string>
    lines: number
    steps: number
    caps: Caps
  }

  const sessions = new Map<SessionID, State>()

  function defaultCaps(): Caps {
    return {
      steps: AUTONOMOUS_MAX_STEPS,
      files: AUTONOMOUS_MAX_FILES_CHANGED,
      lines: AUTONOMOUS_MAX_LINES_CHANGED,
      blockedPaths: AUTONOMOUS_BLOCKED_PATHS,
    }
  }

  /** Returns the active state, creating it on first use. */
  export function get(sessionID: SessionID, overrides?: Partial<Caps>): State {
    let state = sessions.get(sessionID)
    if (!state) {
      const caps = { ...defaultCaps(), ...(overrides ?? {}) }
      state = { files: new Set(), lines: 0, steps: 0, caps }
      sessions.set(sessionID, state)
      return state
    }
    if (overrides) {
      state.caps = { ...state.caps, ...overrides }
    }
    return state
  }

  export function reset(sessionID: SessionID) {
    sessions.delete(sessionID)
  }

  /** Increment step count and return the new value. */
  export function incrementStep(sessionID: SessionID): number {
    const state = get(sessionID)
    state.steps += 1
    return state.steps
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
    return null
  }

  export const LimitExceededError = NamedError.create(
    "AutonomousLimitExceededError",
    z.object({
      kind: z.enum(["steps", "files", "lines", "blocked_path"]),
      current: z.number(),
      limit: z.number(),
      message: z.string(),
    }),
  )

  /** Pretty error message for a tripped cap. */
  export function describe(check: { kind: Kind; current: number; limit: number }): string {
    switch (check.kind) {
      case "steps":
        return `Autonomous step cap reached: ${check.current}/${check.limit}. The session will stop. Set experimental.autonomous_caps.steps to raise this limit.`
      case "files":
        return `Autonomous file-change cap reached: ${check.current}/${check.limit} files modified. Set experimental.autonomous_caps.files to raise.`
      case "lines":
        return `Autonomous line-change cap reached: ${check.current}/${check.limit} lines modified. Set experimental.autonomous_caps.lines to raise.`
      case "blocked_path":
        return `Path is on the autonomous blocked-path list (limit ${check.limit}).`
    }
  }

  /** Throw if the session has just exceeded a cap. No-op on first overage already returned by check. */
  export function assertWithinCaps(sessionID: SessionID) {
    const check = checkAfterIncrement(sessionID)
    if (!check) return
    log.warn("autonomous cap exceeded", check)
    const message = describe(check)
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
      Recorder.emit({
        type: "autonomous.cap_hit",
        sessionID,
        kind: "blocked_path",
        current: 0,
        limit: get(sessionID).caps.blockedPaths.length,
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
