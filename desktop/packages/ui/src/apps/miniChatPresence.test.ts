import { describe, expect, test } from "vitest"
import { isMiniChatPresenceMessage } from "./miniChatPresence"

describe("isMiniChatPresenceMessage", () => {
  test("accepts valid mini chat presence messages", () => {
    expect(
      isMiniChatPresenceMessage({
        type: "mini-chat-session-presence",
        sessionId: "session-1",
        directory: "/workspace",
      }),
    ).toBe(true)

    expect(
      isMiniChatPresenceMessage({
        type: "mini-chat-session-presence",
        sessionId: "session-1",
        directory: "/workspace",
        viewed: false,
      }),
    ).toBe(true)
  })

  test("rejects malformed mini chat presence messages", () => {
    expect(isMiniChatPresenceMessage(null)).toBe(false)
    expect(isMiniChatPresenceMessage({ type: "other" })).toBe(false)
    expect(
      isMiniChatPresenceMessage({
        type: "mini-chat-session-presence",
        sessionId: "",
        directory: "/workspace",
      }),
    ).toBe(false)
    expect(
      isMiniChatPresenceMessage({
        type: "mini-chat-session-presence",
        sessionId: "session-1",
        directory: "",
      }),
    ).toBe(false)
    expect(
      isMiniChatPresenceMessage({
        type: "mini-chat-session-presence",
        sessionId: "session-1",
        directory: "/workspace",
        viewed: "yes",
      }),
    ).toBe(false)
  })
})
