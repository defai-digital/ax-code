import { describe, expect, test } from "bun:test"
import {
  footerProgressBar,
  isFooterSessionStatus,
  PROGRESS_SOFT_MAX,
} from "@/cli/cmd/tui/routes/session/footer-view-model"

describe("footerProgressBar", () => {
  test("returns undefined when idle", () => {
    expect(footerProgressBar({ status: { type: "idle" } })).toBeUndefined()
  })

  test("returns undefined when retrying", () => {
    expect(
      footerProgressBar({
        status: { type: "retry", attempt: 1, message: "rate limited", next: Date.now() + 1000 },
      }),
    ).toBeUndefined()
  })

  test("returns undefined when busy without step data", () => {
    expect(footerProgressBar({ status: { type: "busy", waitState: "llm" } })).toBeUndefined()
  })

  test("renders a 10-cell bar scaled to softMax (default 50)", () => {
    // step=10 / softMax=50 = 20% → 2 filled cells
    const bar = footerProgressBar({ status: { type: "busy", step: 10, maxSteps: 500 } })
    expect(bar).toBeDefined()
    expect(bar!.filled.length + bar!.empty.length).toBe(10)
    expect(bar!.filled).toBe("██")
    expect(bar!.empty).toBe("░░░░░░░░")
    expect(bar!.label).toBe("10")
    expect(bar!.percent).toBe(20)
    expect(bar!.overSoftMax).toBe(false)
  })

  test("uses configurable softMax", () => {
    const bar = footerProgressBar({ status: { type: "busy", step: 5, maxSteps: 500 }, softMax: 10 })
    // 5/10 = 50% → 5 filled
    expect(bar!.filled).toBe("█████")
    expect(bar!.percent).toBe(50)
    expect(bar!.overSoftMax).toBe(false)
  })

  test("flips overSoftMax flag once step exceeds softMax", () => {
    const bar = footerProgressBar({ status: { type: "busy", step: PROGRESS_SOFT_MAX + 1, maxSteps: 500 } })
    expect(bar!.overSoftMax).toBe(true)
    expect(bar!.filled).toBe("██████████") // capped at full
    expect(bar!.percent).toBe(100)
  })

  test("caps fill at 100% even far past softMax (hard cap unchanged)", () => {
    const bar = footerProgressBar({ status: { type: "busy", step: 480, maxSteps: 500 } })
    expect(bar!.filled).toBe("██████████")
    expect(bar!.empty).toBe("")
    expect(bar!.percent).toBe(100)
    expect(bar!.overSoftMax).toBe(true)
    expect(bar!.label).toBe("480") // shows actual step, not capped
  })

  test("clamps negative step", () => {
    const bar = footerProgressBar({ status: { type: "busy", step: -5, maxSteps: 500 } })
    expect(bar!.filled).toBe("")
    expect(bar!.empty).toBe("░░░░░░░░░░")
    expect(bar!.percent).toBe(0)
    expect(bar!.overSoftMax).toBe(false)
  })

  test("returns undefined when maxSteps is 0", () => {
    expect(footerProgressBar({ status: { type: "busy", step: 1, maxSteps: 0 } })).toBeUndefined()
  })

  test("hides bar on narrow terminals (< 80 cols)", () => {
    expect(
      footerProgressBar({ status: { type: "busy", step: 4, maxSteps: 500 }, terminalWidth: 60 }),
    ).toBeUndefined()
  })

  test("renders bar on terminals >= 80 cols", () => {
    expect(
      footerProgressBar({ status: { type: "busy", step: 4, maxSteps: 500 }, terminalWidth: 80 }),
    ).toBeDefined()
  })

  test("uses only static block characters — no shimmer cell", () => {
    const bar = footerProgressBar({ status: { type: "busy", step: 25, maxSteps: 500 } })
    expect(bar!.filled).toMatch(/^█*$/)
    expect(bar!.empty).toMatch(/^░*$/)
    expect(bar!.filled + bar!.empty).not.toMatch(/[▓▒]/)
  })
})

describe("isFooterSessionStatus", () => {
  test("accepts idle", () => {
    expect(isFooterSessionStatus({ type: "idle" })).toBe(true)
  })

  test("accepts busy", () => {
    expect(isFooterSessionStatus({ type: "busy", step: 1, maxSteps: 10 })).toBe(true)
  })

  test("accepts well-formed retry", () => {
    expect(isFooterSessionStatus({ type: "retry", attempt: 1, message: "x", next: 100 })).toBe(true)
  })

  test("rejects retry with wrong types", () => {
    expect(isFooterSessionStatus({ type: "retry", attempt: "1", message: "x", next: 100 })).toBe(false)
  })

  test("rejects null and non-objects", () => {
    expect(isFooterSessionStatus(null)).toBe(false)
    expect(isFooterSessionStatus(undefined)).toBe(false)
    expect(isFooterSessionStatus("idle")).toBe(false)
  })

  test("rejects unknown discriminants", () => {
    expect(isFooterSessionStatus({ type: "running" })).toBe(false)
  })
})
