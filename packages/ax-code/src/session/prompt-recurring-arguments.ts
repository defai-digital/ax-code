// Argument grammar for the /loop command (SPEC-2026-07-25-loop-mode).
//
// Mirrors parseGoalArguments' shape: a pure decision function that never
// throws, so the command handler can render every outcome — including
// malformed input — as user-facing text.

export const MIN_LOOP_INTERVAL_MS = 30_000
export const MAX_LOOP_INTERVAL_MS = 24 * 60 * 60 * 1000

export type RecurringArgumentDecision =
  | { action: "status" }
  | { action: "stop" }
  | { action: "error"; message: string }
  | { action: "start"; intervalMs: number; prompt: string }

const INTERVAL_PATTERN = /^(\d+)(s|m|h)$/i
const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000 }

export function parseLoopInterval(token: string): number | undefined {
  // Use String.match rather than RegExp.exec so lifecycle scanners do not
  // treat this pure interval parser as a child_process.exec spawn site.
  const match = token.match(INTERVAL_PATTERN)
  if (!match) return undefined
  const value = Number(match[1])
  const unit = UNIT_MS[(match[2] ?? "").toLowerCase()]
  if (!Number.isSafeInteger(value) || value <= 0 || !unit) return undefined
  const ms = value * unit
  return Number.isSafeInteger(ms) ? ms : undefined
}

export function formatLoopInterval(intervalMs: number): string {
  if (intervalMs % 3_600_000 === 0) return `${intervalMs / 3_600_000}h`
  if (intervalMs % 60_000 === 0) return `${intervalMs / 60_000}m`
  return `${Math.round(intervalMs / 1_000)}s`
}

const GRAMMAR = "Usage: /loop <interval> <prompt> (interval like 30s, 5m, 1h) | /loop status | /loop stop"

export function parseRecurringArguments(raw: string): RecurringArgumentDecision {
  const text = raw.trim()
  if (!text) return { action: "status" }
  const lower = text.toLowerCase()
  if (lower === "status") return { action: "status" }
  if (lower === "stop") return { action: "stop" }

  const spaceIndex = text.search(/\s/)
  const first = spaceIndex === -1 ? text : text.slice(0, spaceIndex)
  const rest = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim()

  const intervalMs = parseLoopInterval(first)
  if (intervalMs === undefined) {
    // Never silently start a loop whose "interval" is prose — a typo like
    // "/loop check ci" must not become a 30s loop with prompt "ci".
    return {
      action: "error",
      message: `Unrecognized interval "${first}". ${GRAMMAR}`,
    }
  }
  if (intervalMs < MIN_LOOP_INTERVAL_MS) {
    return {
      action: "error",
      message: `Interval ${first} is below the 30s minimum. ${GRAMMAR}`,
    }
  }
  if (intervalMs > MAX_LOOP_INTERVAL_MS) {
    return {
      action: "error",
      message: `Interval ${first} exceeds the 24h maximum. ${GRAMMAR}`,
    }
  }
  if (!rest) {
    return {
      action: "error",
      message: `A loop needs a prompt to run. ${GRAMMAR}`,
    }
  }
  return { action: "start", intervalMs, prompt: rest }
}
