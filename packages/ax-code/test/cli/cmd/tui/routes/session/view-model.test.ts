import { describe, expect, test } from "vitest"
import type { AssistantMessage } from "@ax-code/sdk/v2"
import { assistantMessageStats } from "@/cli/tui/routes/session/view-model"

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

  test("formats output tokens, decode rate, and the first-token wait", () => {
    // 2242 token intervals over a 200s decode window ≈ 11.2 t/s; the 2s to
    // the first token (provider setup, model load, prefill) is reported
    // separately and never enters the denominator.
    const stats = assistantMessageStats(message({ created: 0, completed: 202_000, tokensOut: 2243 }), [
      { type: "step-start" },
      { type: "text", time: { start: 2_000, end: 202_000 } },
      { type: "step-finish", tokens: { input: 10_000, output: 2243, reasoning: 0 } },
    ])
    expect(stats).toEqual({ output: "2.2k", rate: "11.2 t/s", firstToken: "2.0s" })
  })

  test("rounds rates at or above 100 t/s", () => {
    const stats = assistantMessageStats(message({ created: 0, completed: 1_100, tokensOut: 150 }), [
      { type: "step-start" },
      { type: "text", time: { start: 100, end: 1_100 } },
      { type: "step-finish", tokens: { input: 1_000, output: 150, reasoning: 0 } },
    ])
    // 149 token intervals over 1s
    expect(stats?.rate).toBe("149 t/s")
  })

  test("omits rate when the turn has not completed", () => {
    const stats = assistantMessageStats(message({ created: 0, tokensOut: 120 }))
    expect(stats).toEqual({ output: "120" })
  })

  test("gates tiny decode windows (noisy sample)", () => {
    const stats = assistantMessageStats(message({ created: 0, completed: 2_300, tokensOut: 120 }), [
      { type: "step-start" },
      { type: "text", time: { start: 2_000, end: 2_300 } },
      { type: "step-finish", tokens: { input: 1_000, output: 120, reasoning: 0 } },
    ])
    expect(stats).toEqual({ output: "120", firstToken: "2.0s" })
  })

  test("gates small token counts (noisy sample)", () => {
    const stats = assistantMessageStats(message({ created: 0, completed: 4_000, tokensOut: 15 }), [
      { type: "step-start" },
      { type: "text", time: { start: 1_000, end: 4_000 } },
      { type: "step-finish", tokens: { input: 1_000, output: 15, reasoning: 0 } },
    ])
    expect(stats).toEqual({ output: "15", firstToken: "1.0s" })
  })

  test("counts reasoning tokens in the decode population the window spans", () => {
    const stats = assistantMessageStats(message({ created: 0, completed: 3_000, tokensOut: 100 }), [
      { type: "step-start" },
      { type: "reasoning", time: { start: 1_000, end: 2_000 } },
      { type: "text", time: { start: 2_000, end: 3_000 } },
      { type: "step-finish", tokens: { input: 1_000, output: 100, reasoning: 100 } },
    ])
    // (100 output + 100 reasoning − 1) over the 2s window
    expect(stats?.rate).toBe("99.5 t/s")
  })

  test("historical sessions without step parts use one earliest-to-latest window", () => {
    const stats = assistantMessageStats(message({ created: 0, completed: 5_000, tokensOut: 200 }), [
      { type: "text", time: { start: 1_000, end: 5_000 } },
    ])
    // 199 token intervals over 4s
    expect(stats).toEqual({ output: "200", rate: "49.8 t/s", firstToken: "1.0s" })
  })

  test("messages without any part timing report counts only", () => {
    expect(assistantMessageStats(message({ created: 0, completed: 202_000, tokensOut: 2243 }))).toEqual({
      output: "2.2k",
    })
  })

  test("reports cache hit share of the full prompt", () => {
    const stats = assistantMessageStats(
      message({ created: 0, completed: 10_000, tokensIn: 407, tokensOut: 100, cacheRead: 10_640 }),
    )
    expect(stats?.cacheHit).toBe("96%")
  })

  test("omits cache hit when nothing was cached", () => {
    const stats = assistantMessageStats(message({ created: 0, completed: 10_000, tokensIn: 10_658, tokensOut: 368 }))
    expect(stats?.cacheHit).toBeUndefined()
  })

  test("cache-only message still renders without output stats", () => {
    const stats = assistantMessageStats(message({ created: 0, tokensIn: 10, cacheRead: 90 }))
    expect(stats).toEqual({ cacheHit: "90%" })
  })
})
