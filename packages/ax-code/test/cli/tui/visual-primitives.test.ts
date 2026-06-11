import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { lerpRgba, gradientLineRuns } from "@/cli/cmd/tui/ui/primitives/color"
import { resolveVisualCapability } from "@/cli/cmd/tui/ui/primitives/capability"

const RED = RGBA.fromValues(1, 0, 0, 1)
const BLUE = RGBA.fromValues(0, 0, 1, 1)

function channels(color: RGBA) {
  return [color.r, color.g, color.b, color.a]
}

describe("lerpRgba", () => {
  test("returns the endpoints at t=0 and t=1", () => {
    expect(channels(lerpRgba(RED, BLUE, 0))).toEqual(channels(RED))
    expect(channels(lerpRgba(RED, BLUE, 1))).toEqual(channels(BLUE))
  })

  test("interpolates channels at the midpoint", () => {
    const mid = lerpRgba(RED, BLUE, 0.5)
    expect(mid.r).toBeCloseTo(0.5)
    expect(mid.g).toBeCloseTo(0)
    expect(mid.b).toBeCloseTo(0.5)
    expect(mid.a).toBeCloseTo(1)
  })

  test("clamps t outside [0, 1]", () => {
    expect(channels(lerpRgba(RED, BLUE, -2))).toEqual(channels(RED))
    expect(channels(lerpRgba(RED, BLUE, 3))).toEqual(channels(BLUE))
  })
})

describe("gradientLineRuns", () => {
  test("covers the whole line exactly once", () => {
    const line = "___AX-CODE___"
    const runs = gradientLineRuns({ line, from: RED, to: BLUE, width: line.length })
    expect(runs.map((run) => run.text).join("")).toBe(line)
  })

  test("returns no runs for an empty line", () => {
    expect(gradientLineRuns({ line: "", from: RED, to: BLUE, width: 10 })).toEqual([])
  })

  test("merges adjacent cells quantized to the same step", () => {
    const line = "x".repeat(40)
    const runs = gradientLineRuns({ line, from: RED, to: BLUE, width: line.length, steps: 4 })
    expect(runs.length).toBeLessThanOrEqual(4)
    expect(runs.length).toBeGreaterThan(1)
  })

  test("progresses from the start color toward the end color", () => {
    const line = "x".repeat(32)
    const runs = gradientLineRuns({ line, from: RED, to: BLUE, width: line.length })
    const first = runs[0].color
    const last = runs[runs.length - 1].color
    expect(first.r).toBeGreaterThan(first.b)
    expect(last.b).toBeGreaterThan(last.r)
  })

  test("diagonal bias shifts later rows further along the ramp", () => {
    const line = "x".repeat(8)
    const input = { line, from: RED, to: BLUE, width: line.length, rows: 5, diagonalBias: 3 }
    const top = gradientLineRuns({ ...input, row: 0 })
    const bottom = gradientLineRuns({ ...input, row: 4 })
    expect(bottom[0].color.b).toBeGreaterThan(top[0].color.b)
  })

  test("uses a single run when the block is one cell wide", () => {
    const runs = gradientLineRuns({ line: "x", from: RED, to: BLUE, width: 1 })
    expect(runs).toHaveLength(1)
    expect(runs[0].text).toBe("x")
  })
})

describe("resolveVisualCapability", () => {
  const base = { advancedTerminal: false, animationsEnabled: true, nerdFont: false }

  test("defaults to no truecolor without any signal", () => {
    expect(resolveVisualCapability(base).truecolor).toBe(false)
  })

  test("detects truecolor from COLORTERM", () => {
    expect(resolveVisualCapability({ ...base, colorterm: "truecolor" }).truecolor).toBe(true)
    expect(resolveVisualCapability({ ...base, colorterm: "24bit" }).truecolor).toBe(true)
    expect(resolveVisualCapability({ ...base, colorterm: "yes" }).truecolor).toBe(false)
  })

  test("detects truecolor from allowlisted terminals", () => {
    expect(resolveVisualCapability({ ...base, term: "xterm-kitty" }).truecolor).toBe(true)
    expect(resolveVisualCapability({ ...base, termProgram: "WezTerm" }).truecolor).toBe(true)
    expect(resolveVisualCapability({ ...base, termProgram: "Apple_Terminal" }).truecolor).toBe(false)
  })

  test("advanced terminal profile implies truecolor", () => {
    expect(resolveVisualCapability({ ...base, advancedTerminal: true }).truecolor).toBe(true)
  })

  test("passes through animations and nerd font flags", () => {
    const capability = resolveVisualCapability({ ...base, animationsEnabled: false, nerdFont: true })
    expect(capability.animations).toBe(false)
    expect(capability.nerdFont).toBe(true)
  })
})

describe("gauge formatting", () => {
  test("fills proportionally and clamps", async () => {
    const { formatGauge } = await import("@/cli/cmd/tui/ui/primitives/format")
    expect(formatGauge(0)).toBe("▱▱▱▱▱")
    expect(formatGauge(0.5)).toBe("▰▰▰▱▱")
    expect(formatGauge(1)).toBe("▰▰▰▰▰")
    expect(formatGauge(2)).toBe("▰▰▰▰▰")
  })

  test("non-zero ratio always shows at least one filled cell", async () => {
    const { formatGauge } = await import("@/cli/cmd/tui/ui/primitives/format")
    expect(formatGauge(0.01)).toBe("▰▱▱▱▱")
  })
})

describe("footerContextGauge", () => {
  test("returns undefined without tokens or limit", async () => {
    const { footerContextGauge } = await import("@/cli/cmd/tui/routes/session/footer-view-model")
    expect(footerContextGauge({})).toBeUndefined()
    expect(footerContextGauge({ totalTokens: 100 })).toBeUndefined()
    expect(footerContextGauge({ contextLimit: 200000 })).toBeUndefined()
  })

  test("computes ratio, percent, and tone thresholds", async () => {
    const { footerContextGauge } = await import("@/cli/cmd/tui/routes/session/footer-view-model")
    expect(footerContextGauge({ totalTokens: 84_000, contextLimit: 200_000 })).toEqual({
      ratio: 0.42,
      percent: 42,
      tone: "muted",
    })
    expect(footerContextGauge({ totalTokens: 170_000, contextLimit: 200_000 })?.tone).toBe("warning")
    expect(footerContextGauge({ totalTokens: 195_000, contextLimit: 200_000 })?.tone).toBe("error")
  })

  test("clamps overflow to 100%", async () => {
    const { footerContextGauge } = await import("@/cli/cmd/tui/routes/session/footer-view-model")
    const view = footerContextGauge({ totalTokens: 300_000, contextLimit: 200_000 })
    expect(view?.percent).toBe(100)
    expect(view?.ratio).toBe(1)
  })
})
