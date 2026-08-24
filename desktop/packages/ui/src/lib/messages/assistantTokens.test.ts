import { describe, expect, test } from "vitest"
import { findLatestStepTokenUsage } from "./assistantTokens"

describe("findLatestStepTokenUsage", () => {
  test("returns null when no step-finish part exists", () => {
    expect(findLatestStepTokenUsage([])).toBeNull()
    expect(
      findLatestStepTokenUsage([
        { type: "step-start" },
        { type: "text", text: "hello" },
      ]),
    ).toBeNull()
  })

  test("returns the tokens of the LAST step-finish part", () => {
    expect(
      findLatestStepTokenUsage([
        { type: "step-start" },
        { type: "step-finish", tokens: { input: 10_000, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } },
        { type: "step-start" },
        { type: "step-finish", tokens: { input: 30_000, output: 250, reasoning: 40, cache: { read: 20_000, write: 0 } } },
      ]),
    ).toEqual({
      input: 30_000,
      output: 250,
      reasoning: 40,
      cache: { read: 20_000, write: 0 },
    })
  })

  test("defaults missing reasoning/cache fields to zero", () => {
    expect(findLatestStepTokenUsage([{ type: "step-finish", tokens: { input: 500, output: 50 } }])).toEqual({
      input: 500,
      output: 50,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    })
  })

  test("returns null for a malformed step-finish tokens payload", () => {
    expect(findLatestStepTokenUsage([{ type: "step-finish", tokens: { output: 50 } }])).toBeNull()
    expect(findLatestStepTokenUsage([{ type: "step-finish" }])).toBeNull()
  })
})
