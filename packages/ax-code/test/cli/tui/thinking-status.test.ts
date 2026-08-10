import { describe, expect, test } from "vitest"
import { isAssistantThinkingActive } from "../../../src/cli/cmd/tui/routes/session/thinking-status"

describe("isAssistantThinkingActive (#378)", () => {
  test("animates only while the session is busy/retry and the last message is incomplete", () => {
    expect(
      isAssistantThinkingActive({
        sessionStatusType: "busy",
        messageError: undefined,
        hasParts: false,
        isFinal: false,
        isLast: true,
      }),
    ).toBe(true)
    expect(
      isAssistantThinkingActive({
        sessionStatusType: "retry",
        messageError: undefined,
        hasParts: false,
        isFinal: false,
        isLast: true,
      }),
    ).toBe(true)
  })

  test("clears thinking when session is idle, stopped, or errored", () => {
    expect(
      isAssistantThinkingActive({
        sessionStatusType: "idle",
        messageError: undefined,
        hasParts: false,
        isFinal: false,
        isLast: true,
      }),
    ).toBe(false)
    expect(
      isAssistantThinkingActive({
        sessionStatusType: undefined,
        messageError: undefined,
        hasParts: false,
        isFinal: false,
        isLast: true,
      }),
    ).toBe(false)
    expect(
      isAssistantThinkingActive({
        sessionStatusType: "busy",
        messageError: { name: "MessageAbortedError" },
        hasParts: false,
        isFinal: false,
        isLast: true,
      }),
    ).toBe(false)
    expect(
      isAssistantThinkingActive({
        sessionStatusType: "busy",
        messageError: undefined,
        hasParts: true,
        isFinal: false,
        isLast: true,
      }),
    ).toBe(false)
    expect(
      isAssistantThinkingActive({
        sessionStatusType: "busy",
        messageError: undefined,
        hasParts: false,
        isFinal: true,
        isLast: true,
      }),
    ).toBe(false)
  })
})
