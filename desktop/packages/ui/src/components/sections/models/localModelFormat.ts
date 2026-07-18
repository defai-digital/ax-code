/** Format binary model sizes without rounded values overflowing into the next unit. */
export function formatLocalModelBytes(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unknown"
  if (value <= 0) return "0 B"

  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const
  let next = value
  let unit = 0
  while (unit < units.length - 1) {
    const digits = next >= 10 ? 0 : 1
    if (next < 1024 && Number(next.toFixed(digits)) < 1024) break
    next /= 1024
    unit += 1
  }
  return `${next >= 10 ? next.toFixed(0) : next.toFixed(1)} ${units[unit]}`
}
