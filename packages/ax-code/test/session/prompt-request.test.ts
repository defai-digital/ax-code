import { describe, expect, test } from "bun:test"
import { estimateRequestTokens, getLastUserInfo } from "../../src/session/prompt-request"

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
