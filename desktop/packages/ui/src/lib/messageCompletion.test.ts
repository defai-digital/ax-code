import { describe, expect, test } from "vitest"
import type { Part } from "@ax-code/sdk/v2"

import { isMessageComplete } from "./messageCompletion"

const completedAssistant = {
  id: "message-1",
  role: "assistant",
  time: { completed: 123 },
  finish: "stop",
}

describe("isMessageComplete", () => {
  test("requires a completed stop finish", () => {
    expect(isMessageComplete(completedAssistant)).toBe(true)
    expect(isMessageComplete({ ...completedAssistant, finish: "length" })).toBe(false)
    expect(isMessageComplete({ ...completedAssistant, time: {} })).toBe(false)
  })

  test("keeps active reasoning and tool parts incomplete", () => {
    expect(isMessageComplete(completedAssistant, [{ id: "reasoning-1", type: "reasoning", time: {} }] as Part[])).toBe(
      false,
    )

    expect(
      isMessageComplete(completedAssistant, [{ id: "tool-1", type: "tool", state: { status: "running" } }] as Part[]),
    ).toBe(false)

    expect(
      isMessageComplete(completedAssistant, [
        { id: "tool-1", type: "tool", state: { status: "completed" } },
        { id: "reasoning-1", type: "reasoning", time: { end: 456 } },
      ] as Part[]),
    ).toBe(true)
  })
})
