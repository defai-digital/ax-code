import { describe, expect, test } from "vitest"
import type { AssistantMessage } from "@ax-code/sdk/v2"
import { assistantMessageStats } from "@/cli/cmd/tui/routes/session/view-model"

function message(input: {
  created: number
  completed?: number
  tokensIn?: number
  tokensOut?: number
  cacheRead?: number
}): AssistantMessage {
  return {
    time: { created: input.created, completed: input.completed },
    tokens: {
      input: input.tokensIn ?? 0,
      output: input.tokensOut ?? 0,
      reasoning: 0,
      cache: { read: input.cacheRead ?? 0, write: 0 },
    },
  } as AssistantMessage
}

describe("assistantMessageStats", () => {
  test("returns undefined when there is nothing to report", () => {
    expect(assistantMessageStats(message({ created: 1_000, completed: 2_000 }))).toBeUndefined()
  })

  test("formats output tokens and effective rate", () => {
    // 202s for 2243 tokens ≈ 11.1 t/s — the qwen3.8-27b shape from the field
    const stats = assistantMessageStats(message({ created: 0, completed: 202_000, tokensOut: 2243 }))
    expect(stats).toEqual({ output: "2.2k", rate: "11.1 t/s" })
  })

  test("rounds rates at or above 100 t/s", () => {
    const stats = assistantMessageStats(message({ created: 0, completed: 1_000, tokensOut: 150 }))
    expect(stats?.rate).toBe("150 t/s")
  })

  test("omits rate when the turn has not completed", () => {
    const stats = assistantMessageStats(message({ created: 0, tokensOut: 120 }))
    expect(stats).toEqual({ output: "120" })
  })

  test("omits rate for sub-second turns (noisy window)", () => {
    const stats = assistantMessageStats(message({ created: 0, completed: 400, tokensOut: 120 }))
    expect(stats).toEqual({ output: "120" })
  })

  test("reports cache hit share of the full prompt", () => {
    const stats = assistantMessageStats(
      message({ created: 0, completed: 10_000, tokensIn: 407, tokensOut: 100, cacheRead: 10_640 }),
    )
    expect(stats?.cacheHit).toBe("96%")
  })

  test("omits cache hit when nothing was cached", () => {
    const stats = assistantMessageStats(
      message({ created: 0, completed: 10_000, tokensIn: 10_658, tokensOut: 368 }),
    )
    expect(stats?.cacheHit).toBeUndefined()
  })

  test("cache-only message still renders without output stats", () => {
    const stats = assistantMessageStats(message({ created: 0, tokensIn: 10, cacheRead: 90 }))
    expect(stats).toEqual({ cacheHit: "90%" })
  })
})
