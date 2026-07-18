const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

export type RelativeTimeParts =
  | { kind: "empty" }
  | { kind: "seconds"; future: boolean }
  | { kind: "minutes"; future: boolean; count: number }
  | { kind: "duration"; future: boolean; body: string }

/**
 * Pure relative-duration parts for a timestamp delta.
 * Rounds smaller units first so remainders never become "1h 60m" / "1d 24h",
 * and promotes at the round boundary (e.g. 59.5m -> 1h, not "60 minutes").
 */
export function relativeTimeParts(value: number | undefined, now: number = Date.now()): RelativeTimeParts {
  if (!value || !Number.isFinite(value)) {
    return { kind: "empty" }
  }
  const diff = value - now
  const abs = Math.abs(diff)
  const future = diff > 0

  if (abs < MINUTE_MS) {
    return { kind: "seconds", future }
  }

  // Round to whole minutes first so hour/minute split cannot emit "Nm 60m".
  const totalMinutes = Math.round(abs / MINUTE_MS)
  if (totalMinutes < 60) {
    return { kind: "minutes", future, count: Math.max(1, totalMinutes) }
  }

  // Sub-day: split rounded minutes (also covers promotion from 59.5m to 1h).
  if (totalMinutes < 24 * 60) {
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    const body = m > 0 ? `${h}h ${m}m` : `${h}h`
    return { kind: "duration", future, body }
  }

  // Day+: round to whole hours first so day/hour split cannot emit "Nd 24h".
  const totalHours = Math.round(abs / HOUR_MS)
  const d = Math.max(1, Math.floor(totalHours / 24))
  const h = totalHours % 24
  const body = h > 0 ? `${d}d ${h}h` : `${d}d`
  return { kind: "duration", future, body }
}
