import { describe, expect, test } from "vitest"
import { isCliProviderID } from "../../../src/provider/cli/ids"

describe("isCliProviderID", () => {
  test("accepts bundled CLI providers, including ones without the -cli suffix", () => {
    expect(isCliProviderID("antigravity-cli")).toBe(true)
    expect(isCliProviderID("claude-code")).toBe(true)
    expect(isCliProviderID("codex-cli")).toBe(true)
  })

  test("accepts custom providers following the -cli convention", () => {
    expect(isCliProviderID("acme-cli")).toBe(true)
  })

  test("rejects retired providers even when they follow the -cli convention", () => {
    expect(isCliProviderID("gemini-cli")).toBe(false)
    expect(isCliProviderID("minimax-cli")).toBe(false)
    expect(isCliProviderID("qoder-cli")).toBe(false)
    expect(isCliProviderID("MiniMax-CLI")).toBe(false)
  })

  test("rejects API providers, undefined and empty ids", () => {
    expect(isCliProviderID("anthropic")).toBe(false)
    expect(isCliProviderID("openai")).toBe(false)
    expect(isCliProviderID(undefined)).toBe(false)
    expect(isCliProviderID("")).toBe(false)
  })
})
