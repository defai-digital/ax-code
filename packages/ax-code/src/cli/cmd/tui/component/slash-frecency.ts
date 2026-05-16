// Per-install ranking for slash commands. Sits on the KV store keyed
// by command `value` (the same string the dialog uses for trigger).
// Pure functions only — the KV write is wired in dialog-command.tsx.

export type SlashFrecencyEntry = { count: number; lastUsed: number }
export type SlashFrecencyMap = Record<string, SlashFrecencyEntry>

// Cap the persisted map so a long-lived install doesn't accumulate
// hundreds of historical command names. 20 is enough to cover any user's
// real working set with room for one-offs to age out.
export const SLASH_FRECENCY_CAP = 20

// Bias score toward recently-used commands. `count` is the long-horizon
// signal; the time decay (hours since last use) keeps abandoned commands
// from dominating just because they were spammed once. Matches the
// existing prompt-history frecency feel.
export function slashScore(entry: SlashFrecencyEntry, now: number = Date.now()): number {
  const hoursSinceUse = Math.max(0, (now - entry.lastUsed) / 3_600_000)
  return entry.count / (1 + hoursSinceUse)
}

// Insert/update an entry, then evict the lowest-score command if we're
// over the cap. Returns a NEW map so callers can hand it directly to
// KV.set without aliasing.
export function recordSlashUse(
  map: SlashFrecencyMap | undefined,
  value: string,
  now: number = Date.now(),
): SlashFrecencyMap {
  const next: SlashFrecencyMap = { ...(map ?? {}) }
  const prev = next[value]
  next[value] = {
    count: (prev?.count ?? 0) + 1,
    lastUsed: now,
  }
  const keys = Object.keys(next)
  if (keys.length <= SLASH_FRECENCY_CAP) return next
  // Evict the single weakest entry by score. Always preserves the entry
  // we just touched (highest possible recency for its count).
  let weakest: string | undefined
  let weakestScore = Infinity
  for (const key of keys) {
    if (key === value) continue
    const score = slashScore(next[key], now)
    if (score < weakestScore) {
      weakestScore = score
      weakest = key
    }
  }
  if (weakest) delete next[weakest]
  return next
}

// Return up to `limit` command values sorted by score, highest first.
// Filtered to `availableValues` so we never recommend a command that
// has been unregistered or hidden since last use.
export function topSlashRecents(
  map: SlashFrecencyMap | undefined,
  availableValues: Set<string>,
  limit = 3,
  now: number = Date.now(),
): string[] {
  if (!map) return []
  const scored: Array<{ value: string; score: number }> = []
  for (const value of Object.keys(map)) {
    if (!availableValues.has(value)) continue
    scored.push({ value, score: slashScore(map[value], now) })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((x) => x.value)
}
