#!/usr/bin/env -S npx tsx
// Render the Tiel / Cyber-Tiel completion-throughput chart (AX Engine vs MTPLX).
//
// The figure is derived from the "Completion tok/s (incl. TTFT)" table in the README's
// "Apple Silicon, managed local inference" section, so the committed SVG and the table
// beside it can never disagree. It emits a deterministic SVG (no plotting library) and
// supports --check to fail if the committed SVG drifts from the table. Mirrors the
// approach AX Engine uses in scripts/render_tiel_peer_chart.py, adapted to this repo's
// TypeScript scripts. The primary metric is completion tokens/s including TTFT.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(import.meta.dirname, "..")
const SOURCE_DOC = path.join(ROOT, "README.md")
const OUTPUT_SVG = path.join(ROOT, "docs", "images", "tiel-vs-mtplx-2026-09-20.svg")

const AX_COLOR = "#2eaf5f"
const AX_TEXT = "#176c37"
const MTPLX_COLOR = "#f2b705"
const MTPLX_TEXT = "#9a6a00"

export interface PeerCell {
  readonly label: string
  readonly axCompletion: number
  readonly mtplxCompletion: number
}

const PACK_LABELS: Record<string, string> = {
  "Tiel `python-lru`": "Tiel (default)",
  "Cyber-Tiel `python-lru` (alternate)": "Cyber-Tiel (alternate)",
}

function parseVs(cell: string): [number, number] | undefined {
  const clean = cell.replace(/\*\*/g, "").trim()
  const parts = clean.split(/\s+vs\s+/)
  if (parts.length !== 2) return undefined
  const a = Number.parseFloat((parts[0] ?? "").replace(/,/g, ""))
  const b = Number.parseFloat((parts[1] ?? "").replace(/,/g, ""))
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined
  return [a, b]
}

// Parse the README benchmark table: Host | Pack | Completion "A vs B" | Decode "A vs B".
export function parseCompletionTable(markdown: string): PeerCell[] {
  const lines = markdown.split("\n")
  let headerIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line && line.includes("Completion tok/s") && line.includes("Decode tok/s")) {
      headerIndex = i
      break
    }
  }
  if (headerIndex === -1) {
    throw new Error("completion/decode table header missing from README")
  }
  const cells: PeerCell[] = []
  for (const line of lines.slice(headerIndex + 1)) {
    const stripped = line.trim()
    if (!stripped.startsWith("|")) {
      if (cells.length) break
      continue
    }
    const row = stripped
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim())
    if (row.length < 4) continue
    const host = row[0] ?? ""
    const pack = row[1] ?? ""
    if (/^[-: ]+$/.test(host)) continue
    const completion = parseVs(row[2] ?? "")
    if (!completion) continue
    const packLabel = PACK_LABELS[pack] ?? pack
    cells.push({
      label: `${host} · ${packLabel}`,
      axCompletion: completion[0],
      mtplxCompletion: completion[1],
    })
  }
  if (cells.length !== 3) {
    throw new Error(`expected the three-cell completion table, got ${cells.length} rows`)
  }
  return cells
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export function renderSvg(cells: readonly PeerCell[]): string {
  const labelWidth = 250
  const plotLeft = labelWidth + 8
  const plotRight = 812
  const rowHeight = 46
  const barHeight = 15
  const top = 104
  const width = 840
  const height = top + rowHeight * cells.length + 58
  const plotWidth = plotRight - plotLeft

  const maxValue = Math.max(...cells.map((c) => Math.max(c.axCompletion, c.mtplxCompletion)))
  const scaleTop = (Math.floor(maxValue / 50) + 1) * 50
  const xFor = (value: number) => plotLeft + plotWidth * (value / scaleTop)

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}" font-family="Helvetica, Arial, sans-serif">`,
  )
  parts.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`)
  parts.push(
    `<text x="24" y="32" font-size="18" font-weight="700" fill="#12211a">` +
      `Tiel / Cyber-Tiel completion — AX Engine vs MTPLX 2.11.3</text>`,
  )
  parts.push(
    `<text x="24" y="52" font-size="12.5" fill="#4a5a52">` +
      `Completion tokens/s including TTFT, higher is better · six samples · cold KV · MTP depth 3</text>`,
  )
  parts.push(
    `<text x="24" y="68" font-size="12.5" fill="#4a5a52">` +
      `Native API (not ax-engine serve, not an AX Code session) · campaign 2026-09-20</text>`,
  )

  for (let value = 0; value <= scaleTop; value += 50) {
    const gx = xFor(value)
    parts.push(
      `<line x1="${gx.toFixed(1)}" y1="${top - 12}" x2="${gx.toFixed(1)}" ` +
        `y2="${top + rowHeight * cells.length - 6}" stroke="#e6ece9" stroke-width="1"/>`,
    )
    parts.push(
      `<text x="${gx.toFixed(1)}" y="${top + rowHeight * cells.length + 12}" ` +
        `font-size="10.5" fill="#7a8a82" text-anchor="middle">${value}</text>`,
    )
  }

  const legendY = 86
  parts.push(`<rect x="${plotLeft}" y="${legendY - 9}" width="12" height="12" fill="${AX_COLOR}"/>`)
  parts.push(`<text x="${plotLeft + 16}" y="${legendY + 1}" font-size="12" fill="#12211a">AX Engine</text>`)
  parts.push(`<rect x="${plotLeft + 96}" y="${legendY - 9}" width="12" height="12" fill="${MTPLX_COLOR}"/>`)
  parts.push(`<text x="${plotLeft + 112}" y="${legendY + 1}" font-size="12" fill="#12211a">MTPLX</text>`)

  cells.forEach((cell, index) => {
    const rowTop = top + index * rowHeight
    const axY = rowTop + 4
    const mtY = rowTop + 4 + barHeight + 3
    parts.push(
      `<text x="24" y="${rowTop + barHeight + 6}" font-size="11.5" fill="#22332c">` +
        `${escapeText(cell.label)}</text>`,
    )
    const delta = ((cell.axCompletion - cell.mtplxCompletion) / cell.mtplxCompletion) * 100
    const sign = delta >= 0 ? "+" : ""
    parts.push(
      `<text x="${plotRight}" y="${rowTop + barHeight + 6}" font-size="11" fill="#5a6a62" ` +
        `text-anchor="end">${sign}${delta.toFixed(1)}%</text>`,
    )
    const axW = xFor(cell.axCompletion) - plotLeft
    const mtW = xFor(cell.mtplxCompletion) - plotLeft
    parts.push(`<rect x="${plotLeft}" y="${axY}" width="${axW.toFixed(1)}" height="${barHeight}" fill="${AX_COLOR}"/>`)
    parts.push(
      `<text x="${(axW + plotLeft + 5).toFixed(1)}" y="${axY + barHeight - 3}" font-size="10.5" ` +
        `fill="${AX_TEXT}">${cell.axCompletion.toFixed(2)}</text>`,
    )
    parts.push(
      `<rect x="${plotLeft}" y="${mtY}" width="${mtW.toFixed(1)}" height="${barHeight}" fill="${MTPLX_COLOR}"/>`,
    )
    parts.push(
      `<text x="${(mtW + plotLeft + 5).toFixed(1)}" y="${mtY + barHeight - 3}" font-size="10.5" ` +
        `fill="${MTPLX_TEXT}">${cell.mtplxCompletion.toFixed(2)}</text>`,
    )
  })

  parts.push(
    `<text x="24" y="${height - 16}" font-size="10.5" fill="#7a8a82">` +
      `Derived from the README completion table (native API, not AX Code session speed; ` +
      `version-pinned snapshot, not a permanent ranking). Generated by script/render-tiel-peer-chart.ts.</text>`,
  )
  parts.push("</svg>")
  return parts.join("\n") + "\n"
}

export function main(argv: readonly string[] = []): number {
  const check = argv.includes("--check")
  const cells = parseCompletionTable(readFileSync(SOURCE_DOC, "utf-8"))
  const svg = renderSvg(cells)
  if (check) {
    const existing = (() => {
      try {
        return readFileSync(OUTPUT_SVG, "utf-8")
      } catch {
        return ""
      }
    })()
    if (existing !== svg) {
      process.stderr.write(
        `ERROR: docs/images/tiel-vs-mtplx-2026-09-20.svg is stale; run tsx script/render-tiel-peer-chart.ts\n`,
      )
      return 1
    }
    process.stdout.write("Tiel peer chart is up to date\n")
    return 0
  }
  mkdirSync(path.dirname(OUTPUT_SVG), { recursive: true })
  writeFileSync(OUTPUT_SVG, svg, "utf-8")
  process.stdout.write(`wrote docs/images/tiel-vs-mtplx-2026-09-20.svg (${cells.length} cells)\n`)
  return 0
}

const invokedDirectly = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2))
}
