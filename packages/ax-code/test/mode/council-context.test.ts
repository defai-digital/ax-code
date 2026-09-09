import { describe, expect, test } from "vitest"
import { CouncilContext } from "../../src/mode/council-context"

describe("Council context admission", () => {
  test("accepts the exact legacy boundary without splitting Unicode", () => {
    const context = "\u{1f600}".repeat(12_000)
    expect(CouncilContext.admit(context)).toMatchObject({
      status: "accepted",
      suppliedCharacters: 24_000,
      suppliedBytes: 48_000,
    })
    expect(CouncilContext.userPrompt({ kind: "review", question: "Review", context })).toContain(context)
    expect(CouncilContext.admit(context + "x").status).toBe("rejected")
  })

  test("fingerprints the complete supplied context including a rejected tail", () => {
    const context = "x".repeat(24_000)
    expect(CouncilContext.admit(context + "A").sha256).not.toBe(CouncilContext.admit(context + "B").sha256)
  })

  test("keeps question, context, and debate evidence in the canonical prompt", () => {
    const prompt = CouncilContext.userPrompt({
      kind: "design",
      question: "REQUIREMENT",
      context: "SOURCE",
      debateContext: "DEBATE",
    })
    for (const value of ["REQUIREMENT", "SOURCE", "DEBATE"]) expect(prompt).toContain(value)
  })

  test("accounts for fallback and framing against the smallest member input budget", () => {
    const result = CouncilContext.checkPrompt({
      system: "system",
      user: "evidence",
      fallbackInstruction: "json fallback",
      members: [
        { memberId: "large", limit: { context: 100_000 }, maxOutputTokens: 4000 },
        { memberId: "small", limit: { input: 2000, context: 10_000 }, maxOutputTokens: 4000 },
      ],
    })
    expect(result.ok).toBe(false)
    expect(result.reasons).toHaveLength(1)
    expect(result.reasons[0]).toContain("small")
    expect(result.promptBytes).toBe(Buffer.byteLength("systemevidence\n\njson fallback"))
    expect(result.estimatedInputTokens).toBe(result.promptBytes + CouncilContext.FRAMING_RESERVE_TOKENS)
  })

  test("reserves the actual requested output even when an explicit input cap exists", () => {
    const result = CouncilContext.checkPrompt({
      system: "s",
      user: "u",
      fallbackInstruction: "json",
      members: [{ memberId: "m", limit: { input: 20_000, context: 10_000 }, maxOutputTokens: 9000 }],
    })
    expect(result.ok).toBe(false)
    expect(result.reasons[0]).toContain("1000 available")
    expect(result.reasons[0]).toContain("output reserve 9000")
  })

  test("discloses unknown limits but enforces the complete prompt byte cap", () => {
    const input = {
      system: "s",
      user: "u",
      fallbackInstruction: "json",
      members: [{ memberId: "unknown", maxOutputTokens: 4000 }],
    }
    expect(CouncilContext.checkPrompt(input)).toMatchObject({ ok: true, unknownLimitMembers: ["unknown"] })
    expect(CouncilContext.checkPrompt({ ...input, user: "x".repeat(CouncilContext.MAX_PROMPT_BYTES) }).ok).toBe(false)
  })
})
