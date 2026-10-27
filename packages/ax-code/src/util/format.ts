// Shorten `s` to at most `max` characters, replacing the tail with an
// ellipsis ("...") when it overflows. A budget too small to fit the
// ellipsis (`max <= 3`) hard-truncates instead: appending "..." would
// make the result longer than `max`.
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  if (max <= 3) return s.slice(0, Math.max(0, max))
  return s.slice(0, max - 3) + "..."
}

export function formatDuration(secs: number) {
  if (secs <= 0) return ""
  if (secs < 60) return `${secs}s`
  if (secs < 3600) {
    const mins = Math.floor(secs / 60)
    const remaining = secs % 60
    return remaining > 0 ? `${mins}m ${remaining}s` : `${mins}m`
  }
  if (secs < 86400) {
    const hours = Math.floor(secs / 3600)
    const remaining = Math.floor((secs % 3600) / 60)
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`
  }
  if (secs < 604800) {
    const days = Math.floor(secs / 86400)
    return days === 1 ? "~1 day" : `~${days} days`
  }
  const weeks = Math.floor(secs / 604800)
  return weeks === 1 ? "~1 week" : `~${weeks} weeks`
}
