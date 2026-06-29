import { describe, expect, test } from "vitest"

import {
  getNextUserMessageAfter,
  getPreviousUserMessageBefore,
  getRevertedUserMessages,
  getVisibleMessagesBeforeRevert,
} from "./revert-order"

const messages = [
  { id: "msg_z_user_a", role: "user" },
  { id: "msg_y_assistant_a", role: "assistant" },
  { id: "msg_b_user_b", role: "user" },
  { id: "msg_a_assistant_b", role: "assistant" },
  { id: "msg_m_user_c", role: "user" },
]

describe("revert message ordering", () => {
  test("keeps previous turns by array position instead of lexicographic id order", () => {
    expect(getVisibleMessagesBeforeRevert(messages, "msg_m_user_c").map((message) => message.id)).toEqual([
      "msg_z_user_a",
      "msg_y_assistant_a",
      "msg_b_user_b",
      "msg_a_assistant_b",
    ])
  })

  test("returns reverted user messages from the marker onward", () => {
    expect(getRevertedUserMessages(messages, "msg_b_user_b").map((message) => message.id)).toEqual([
      "msg_b_user_b",
      "msg_m_user_c",
    ])
  })

  test("navigates user messages by array position", () => {
    const userMessages = messages.filter((message) => message.role === "user")

    expect(getPreviousUserMessageBefore(userMessages, "msg_m_user_c")?.id).toBe("msg_b_user_b")
    expect(getNextUserMessageAfter(userMessages, "msg_b_user_b")?.id).toBe("msg_m_user_c")
  })

  test("preserves all messages when the revert marker is missing", () => {
    expect(getVisibleMessagesBeforeRevert(messages, "missing")).toEqual(messages)
    expect(getRevertedUserMessages(messages, "missing")).toEqual([])
  })
})
