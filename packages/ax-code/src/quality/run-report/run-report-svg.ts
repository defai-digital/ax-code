/**
 * Small, dependency-free helpers for the server-rendered SVG charts. The dashboard is
 * static, offline and printable, so charts are plain SVG strings built from linear
 * scales; no client-side charting runtime is shipped.
 */

/** "Nice" tick values from 0 up to and including a value >= max (1/2/5 steps, like d3-scale). */
export function niceTicks(max: number, target = 5): number[] {
  const safe = Number.isFinite(max) && max > 0 ? max : 1
  const count = Number.isFinite(target) ? Math.max(1, Math.min(100, Math.floor(target))) : 5
  const rough = safe / count
  const magnitude = Math.max(Number.MIN_VALUE, 10 ** Math.floor(Math.log10(rough)))
  const residual = rough / magnitude
  const step = (residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1) * magnitude
  if (!Number.isFinite(step) || step <= 0) return [0, safe]
  const ticks: number[] = []
  // Count indices instead of repeatedly adding a possibly underflowed step.
  // Significant-digit rounding preserves sub-millisecond and subnormal domains.
  const last = Math.min(100, Math.ceil(safe / step))
  for (let i = 0; i <= last; i++) {
    const raw = i * step
    const tick = Number.isFinite(raw) ? Number(raw.toPrecision(15)) : safe
    ticks.push(i === last ? Math.max(tick, safe) : tick)
  }
  return ticks
}

/** Map a domain value to a pixel offset. Degenerate domains collapse to 0 instead of NaN. */
export function linear(domainMax: number, rangeMax: number) {
  return (value: number) => (domainMax > 0 && Number.isFinite(value) ? (value / domainMax) * rangeMax : 0)
}

/** Duration for axes and tooltips: 850ms, 1.2s, 12s, 2m 5s, 1h 5m. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

/** Keep a label inside a column, retaining its leading text and an ellipsis. */
export function clip(text: string, max: number): string {
  const limit = Math.max(0, Math.floor(max))
  if (Number.isNaN(limit) || limit === 0) return ""
  const chars = Array.from(text)
  return chars.length > limit ? `${chars.slice(0, limit - 1).join("")}…` : text
}
