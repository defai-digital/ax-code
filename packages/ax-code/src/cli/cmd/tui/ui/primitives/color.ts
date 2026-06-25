// Pure gradient color math for the primitives layer (ADR-031).
//
// Gradient runs are computed once per (text, colors) via memos at the call
// site — never per frame. Adjacent cells quantized to the same gradient step
// are merged into a single run to bound the number of rendered spans.

import { RGBA } from "@ax-code/opentui-core"

export function lerpRgba(a: RGBA, b: RGBA, t: number): RGBA {
  const f = Math.min(1, Math.max(0, t))
  return RGBA.fromValues(a.r + (b.r - a.r) * f, a.g + (b.g - a.g) * f, a.b + (b.b - a.b) * f, a.a + (b.a - a.a) * f)
}

export interface GradientRun {
  text: string
  color: RGBA
}

export function gradientLineRuns(input: {
  line: string
  from: RGBA
  to: RGBA
  // Widest line of the block, so every line shares one ramp.
  width: number
  // Position of this line in a multi-line block (enables a diagonal ramp).
  row?: number
  rows?: number
  // Extra columns of ramp phase per row; 0 keeps the gradient horizontal.
  diagonalBias?: number
  // Quantization steps; adjacent cells in the same step share one span.
  steps?: number
}): GradientRun[] {
  const { line, from, to } = input
  if (line.length === 0) return []

  const row = input.row ?? 0
  const rows = input.rows ?? 1
  const bias = input.diagonalBias ?? 0
  const steps = Math.max(2, input.steps ?? 16)
  const span = Math.max(1, input.width - 1 + Math.max(0, rows - 1) * bias)

  const runs: GradientRun[] = []
  let runStart = 0
  let runStep = -1
  for (let i = 0; i <= line.length; i++) {
    const t = Math.min(1, Math.max(0, (i + row * bias) / span))
    const step = i === line.length ? -2 : Math.round(t * (steps - 1))
    if (step === runStep) continue
    if (i > 0) {
      runs.push({
        text: line.slice(runStart, i),
        color: lerpRgba(from, to, runStep / (steps - 1)),
      })
    }
    runStart = i
    runStep = step
  }
  return runs
}
