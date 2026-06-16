import { describe, expect, test } from "bun:test"
import { estimateRequestTokens, estimateToolDefinitionTokens, getLastUserInfo } from "../../src/session/prompt-request"

describe("session.prompt request helpers", () => {
  test("estimates request tokens with per-item overhead", () => {
    const total = estimateRequestTokens({
      system: ["abcd"],
      messages: [
        { role: "user", content: "abcdefgh" },
        { role: "assistant", content: [{ type: "text", text: "abcd" }] },
      ] as any,
    })

    expect(total).toBeGreaterThan(0)
    expect(total).toBe(5 + 6 + 12)
  })

  test("repeated estimates of the same message objects are stable", () => {
    const messages = [
      { role: "user", content: "abcdefgh" },
      { role: "assistant", content: [{ type: "text", text: "abcd" }] },
    ] as any
    const first = estimateRequestTokens({ system: [], messages })
    // Second call hits the per-message cache for array content.
    const second = estimateRequestTokens({ system: [], messages })
    expect(second).toBe(first)

    // A replaced message object (how the prompt loop expresses content
    // changes) must miss the cache and reflect its new content.
    const grown = [messages[0], { role: "assistant", content: [{ type: "text", text: "abcd".repeat(10) }] }] as any
    expect(estimateRequestTokens({ system: [], messages: grown })).toBeGreaterThan(first)
  })

  test("includes tool definitions in request-size estimates", () => {
    const small = estimateToolDefinitionTokens([
      {
        id: "read",
        description: "Read a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    ])
    const large = estimateToolDefinitionTokens([
      {
        id: "read",
        description: "Read a file",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "x".repeat(200) },
            offset: { type: "number" },
            limit: { type: "number" },
          },
          required: ["path"],
        },
      },
    ])

    expect(small).toBeGreaterThan(0)
    expect(large).toBeGreaterThan(small)
  })

  test("returns the latest user info", () => {
    const firstUser = { id: "msg_1", sessionID: "ses_1", role: "user", agent: "build" }
    const latestUser = { id: "msg_3", sessionID: "ses_1", role: "user", agent: "review" }

    const result = getLastUserInfo([
      { info: firstUser, parts: [] },
      { info: { id: "msg_2", sessionID: "ses_1", role: "assistant" }, parts: [] },
      { info: latestUser, parts: [] },
    ] as any)

    expect(result?.agent).toBe("review")
  })

  test("returns undefined when there is no user message", () => {
    expect(getLastUserInfo([{ info: { id: "msg_1", sessionID: "ses_1", role: "assistant" }, parts: [] }] as any)).toBe(
      undefined,
    )
  })
})
