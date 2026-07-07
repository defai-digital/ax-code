import { esc, tone } from "./dre-graph-format"

export function chip(input: { label: string; kind?: string }) {
  return `<span class="chip ${esc(input.kind ?? "neutral")}">${esc(input.label)}</span>`
}

export function stat(input: { label: string; value: string; kind?: string; icon?: string }) {
  return [
    `<div class="stat ${esc(input.kind ?? "neutral")}">`,
    input.icon ? `<span class="stat-icon">${input.icon}</span>` : "",
    `<span class="stat-label">${esc(input.label)}</span>`,
    `<strong class="stat-value">${esc(input.value)}</strong>`,
    "</div>",
  ].join("")
}
export function flow(nodes: string[], opts?: { max?: number }) {
  if (nodes.length === 0) return `<p class="empty">No recorded nodes.</p>`
  const runs: { name: string; count: number }[] = []
  for (const n of nodes) {
    const last = runs[runs.length - 1]
    if (last && last.name === n) last.count++
    else runs.push({ name: n, count: 1 })
  }
  const max = opts?.max ?? 20
  const truncated = runs.length > max
  const visible = truncated ? runs.slice(0, max) : runs
  return [
    `<div class="flow">`,
    visible
      .map((item, idx) =>
        [
          idx > 0 ? `<span class="join" aria-hidden="true"></span>` : "",
          item.count > 1
            ? `<span class="node group">${esc(item.name)}<span class="node-count">×${item.count}</span></span>`
            : `<span class="node">${esc(item.name)}</span>`,
        ].join(""),
      )
      .join(""),
    truncated
      ? `<span class="join" aria-hidden="true"></span><span class="node trunc">+${runs.length - max} more</span>`
      : "",
    `</div>`,
    nodes.length > 10 ? `<p class="flow-summary">${nodes.length} total calls across ${runs.length} groups</p>` : "",
  ].join("")
}

export function stepSummary(nodes: string[]) {
  if (nodes.length === 0) return `<span class="muted">empty</span>`
  const counts = new Map<string, number>()
  for (const n of nodes) {
    if (n.endsWith(" ok") || n.endsWith(" ERR") || n.startsWith("Step ") || n.startsWith("Start ")) continue
    const colonIdx = n.indexOf(":")
    const name = colonIdx > 0 ? n.slice(0, colonIdx).trim() : n.trim()
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const max = Math.max(...sorted.map((s) => s[1]), 1)
  return [
    `<div class="step-bars">`,
    sorted
      .slice(0, 6)
      .map(([name, count]) => {
        const pct = Math.min(100, (count / max) * 100)
        const color = count > 10 ? "var(--warn)" : "var(--accent)"
        return `<div class="step-bar-row"><span class="step-bar-label">${esc(name)}</span><div class="step-bar-track"><div class="step-bar-fill" style="width:${pct.toFixed(0)}%;background:${color}"></div></div><span class="step-bar-count">${count}</span></div>`
      })
      .join(""),
    sorted.length > 6 ? `<span class="muted" style="font-size:11px">+${sorted.length - 6} more tools</span>` : "",
    `</div>`,
  ].join("")
}

export function gauge(input: { score: number; max: number; level: string }) {
  const pct = Math.min(1, Math.max(0, input.score / input.max))
  const r = 44
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct * 0.75)
  const color =
    { critical: "#dc2626", high: "#ef4444", medium: "#eab308", low: "#22c55e" }[tone(input.level)] ?? "#22c55e"
  return [
    `<svg class="gauge" viewBox="0 0 100 100" width="128" height="128">`,
    `<circle cx="50" cy="50" r="${r}" fill="none" stroke="rgba(39,39,42,0.8)" stroke-width="5" stroke-dasharray="${circ * 0.75} ${circ * 0.25}" stroke-dashoffset="0" transform="rotate(135 50 50)" stroke-linecap="round"/>`,
    `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-dasharray="${circ * 0.75} ${circ * 0.25}" stroke-dashoffset="${offset}" transform="rotate(135 50 50)" stroke-linecap="round" style="filter: drop-shadow(0 0 8px ${color}30)"/>`,
    `<text x="50" y="44" text-anchor="middle" fill="${color}" font-size="24" font-weight="700">${input.score}</text>`,
    `<text x="50" y="58" text-anchor="middle" fill="#a1a1aa" font-size="9">/ ${input.max}</text>`,
    `<text x="50" y="76" text-anchor="middle" fill="${color}" font-size="7.5" font-weight="700" letter-spacing="0.12em">${input.level.toUpperCase()}</text>`,
    `</svg>`,
  ].join("")
}

export function barChart(input: {
  items: { label: string; value: number; detail?: string }[]
  max?: number
  unit?: string
  colorFn?: (v: number) => string
}) {
  if (input.items.length === 0) return `<p class="empty">No data.</p>`
  const max = input.max ?? Math.max(...input.items.map((i) => i.value), 1)
  const colorFn = input.colorFn ?? (() => "var(--accent)")
  return [
    `<div class="bar-chart">`,
    input.items
      .map((item) => {
        const pct = Math.min(100, Math.max(0, (item.value / max) * 100))
        const color = colorFn(item.value)
        return [
          `<div class="bar-row">`,
          `<span class="bar-label">${esc(item.label)}</span>`,
          `<div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>`,
          `<span class="bar-value" style="color:${color}">${item.value}${input.unit ? esc(input.unit) : ""}</span>`,
          item.detail ? `<span class="bar-detail">${esc(item.detail)}</span>` : "",
          `</div>`,
        ].join("")
      })
      .join(""),
    `</div>`,
  ].join("")
}
