import { describe, expect, test } from "vitest"
import type { ModelMessage } from "ai"
import { TokenEstimate } from "@/provider/token-estimate"
import { Token } from "@/util/token"

type UserContent = Extract<ModelMessage, { role: "user" }>["content"]

describe("textTokens", () => {
  test("matches the legacy chars/4 rounding heuristic", () => {
    expect(TokenEstimate.textTokens("")).toBe(0)
    expect(TokenEstimate.textTokens("abcd")).toBe(1)
    expect(TokenEstimate.textTokens("abcde")).toBe(1) // round(5/4) = 1
    expect(TokenEstimate.textTokens("abcdefgh")).toBe(2)
    expect(TokenEstimate.textTokens("a".repeat(400))).toBe(100)
  })

  test("stays an alias of Token.estimate", () => {
    for (const sample of ["", "hello world", "x".repeat(999)]) {
      expect(TokenEstimate.textTokens(sample)).toBe(Token.estimate(sample))
    }
  })
})

describe("messageTokens", () => {
  test("string content gets chars/4 plus the 4-token overhead", () => {
    const message: ModelMessage = { role: "user", content: "abcd" }
    expect(TokenEstimate.messageTokens(message)).toBe(Token.estimate("abcd") + 4)
  })

  test("parts content matches the legacy whole-array serialization", () => {
    const content: UserContent = [
      { type: "text", text: "hello world" },
      { type: "text", text: "foo bar baz" },
    ]
    const message: ModelMessage = { role: "user", content }
    const legacy = Token.estimate(JSON.stringify(content)) + 4
    expect(TokenEstimate.messageTokens(message)).toBe(legacy)
  })

  test("per-message cache is keyed on the message object (parts content)", () => {
    const content: UserContent = [{ type: "text", text: "hello" }]
    const message: ModelMessage = { role: "user", content }
    const first = TokenEstimate.messageTokens(message)
    // Mutating content after the first estimate must not change the result:
    // the WeakMap cache is keyed on object identity (same contract as the
    // previous prompt-request cache). String content is cheap enough that it
    // is computed fresh on every call, like the previous implementation.
    ;(message as { content: unknown }).content = [{ type: "text", text: "a".repeat(4000) }]
    expect(TokenEstimate.messageTokens(message)).toBe(first)
    // A fresh object with the mutated content computes fresh.
    expect(TokenEstimate.messageTokens({ role: "user", content: [{ type: "text", text: "a".repeat(4000) }] })).toBe(
      Token.estimate(JSON.stringify([{ type: "text", text: "a".repeat(4000) }])) + 4,
    )
    // String content is not cached.
    const stringMessage: ModelMessage = { role: "user", content: "abcd" }
    expect(TokenEstimate.messageTokens(stringMessage)).toBe(5)
    ;(stringMessage as { content: string }).content = "a".repeat(4000)
    expect(TokenEstimate.messageTokens(stringMessage)).toBe(1004)
  })

  test("media parts are priced at the fixed constants, not serialized length", () => {
    const imageMessage: ModelMessage = {
      role: "user",
      content: [{ type: "image", image: new URL("https://example.test/cat.png") }],
    }
    expect(TokenEstimate.messageTokens(imageMessage)).toBe(TokenEstimate.IMAGE_TOKENS + 4)

    const pdfMessage: ModelMessage = {
      role: "user",
      content: [{ type: "file", data: "a".repeat(10_000), mediaType: "application/pdf" }],
    }
    expect(TokenEstimate.messageTokens(pdfMessage)).toBe(TokenEstimate.PDF_TOKENS + 4)
  })

  test("video and audio parts are not estimated (0 tokens, flagged)", () => {
    const message: ModelMessage = {
      role: "user",
      content: [{ type: "file", data: new URL("https://example.test/clip.mp4"), mediaType: "video/mp4" }],
    }
    expect(TokenEstimate.messageTokens(message)).toBe(4)
    expect(TokenEstimate.hasUnestimatedMedia([message])).toBe(true)
    expect(TokenEstimate.mediaTokenTotal([message])).toBe(0)
  })
})

describe("mediaTokens", () => {
  test("image, pdf, video/audio, and plain text parts", () => {
    expect(TokenEstimate.mediaTokens({ type: "image", image: "https://x/y.png" })).toEqual({
      tokens: TokenEstimate.IMAGE_TOKENS,
      unestimated: false,
    })
    expect(TokenEstimate.mediaTokens({ type: "file", mediaType: "application/pdf" })).toEqual({
      tokens: TokenEstimate.PDF_TOKENS,
      unestimated: false,
    })
    expect(TokenEstimate.mediaTokens({ type: "file", mediaType: "audio/mpeg" })).toEqual({
      tokens: 0,
      unestimated: true,
    })
    expect(TokenEstimate.mediaTokens({ type: "text", text: "hi" })).toEqual({ tokens: 0, unestimated: false })
  })
})

describe("toolSchemaTokens", () => {
  test("serializes name/description/parameters with the 8-token overhead per tool", () => {
    const tool = { id: "bash", description: "run commands", inputSchema: { type: "object" } }
    const legacy =
      Token.estimate(JSON.stringify({ name: "bash", description: "run commands", parameters: tool.inputSchema })) + 8
    expect(TokenEstimate.toolSchemaTokens([tool])).toBe(legacy)
    expect(TokenEstimate.toolSchemaTokens([tool, tool])).toBe(legacy * 2)
  })
})

describe("requestTokens", () => {
  test("system + messages without tools matches the previous estimateRequestTokens", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hello world" },
      { role: "assistant", content: [{ type: "text", text: "hi there" }] },
    ]
    const system = ["system prompt one", "system prompt two"]
    const expected =
      Token.estimate(system[0]!) +
      4 +
      Token.estimate(system[1]!) +
      4 +
      Token.estimate("hello world") +
      4 +
      Token.estimate(JSON.stringify([{ type: "text", text: "hi there" }])) +
      4
    expect(TokenEstimate.requestTokens({ system, messages })).toBe(expected)
  })

  test("tools add the per-schema estimate on top", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "abcd" }]
    const tools = [{ id: "bash", description: "run commands", inputSchema: { type: "object" } }]
    const withoutTools = TokenEstimate.requestTokens({ system: [], messages })
    const withTools = TokenEstimate.requestTokens({ system: [], messages, tools })
    expect(withTools - withoutTools).toBe(TokenEstimate.toolSchemaTokens(tools))
  })
})
