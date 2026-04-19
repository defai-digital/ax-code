import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import {
  createAutoSubmitSessionRoute,
  initialPromptAutoSubmitKey,
  shouldAutoSubmitInitialPrompt,
} from "../../src/cli/cmd/tui/routes/session/initial-prompt"

describe("session initial prompt helpers", () => {
  test("builds an auto-submit session route with a cloned prompt", () => {
    const [store, setStore] = createStore({
      input: "count lines",
      mode: "normal" as const,
      parts: [],
    })

    const route = createAutoSubmitSessionRoute({
      sessionID: "ses_1",
      initialPrompt: store,
    })

    setStore("input", "mutated")

    expect(route).toEqual({
      type: "session",
      sessionID: "ses_1",
      initialPrompt: {
        input: "count lines",
        mode: "normal",
        parts: [],
      },
      autoSubmit: true,
    })
  })

  test("auto-submits only once after the prompt is restored and dependencies are ready", () => {
    const key = initialPromptAutoSubmitKey({
      sessionID: "ses_1",
      autoSubmit: true,
      initialPromptInput: "count lines",
    })

    expect(key).toBe("ses_1:count lines")
    expect(
      shouldAutoSubmitInitialPrompt({
        sessionID: "ses_1",
        autoSubmit: true,
        initialPromptInput: "count lines",
        currentInput: "count lines",
        syncReady: true,
        modelReady: true,
      }),
    ).toBeTrue()
    expect(
      shouldAutoSubmitInitialPrompt({
        sessionID: "ses_1",
        autoSubmit: true,
        initialPromptInput: "count lines",
        currentInput: "count lines",
        syncReady: true,
        modelReady: true,
        submittedKey: key,
      }),
    ).toBeFalse()
  })

  test("does not auto-submit before readiness or when the prompt text does not match", () => {
    expect(
      shouldAutoSubmitInitialPrompt({
        sessionID: "ses_1",
        autoSubmit: true,
        initialPromptInput: "count lines",
        currentInput: "count lines",
        syncReady: false,
        modelReady: true,
      }),
    ).toBeFalse()

    expect(
      shouldAutoSubmitInitialPrompt({
        sessionID: "ses_1",
        autoSubmit: true,
        initialPromptInput: "count lines",
        currentInput: "other",
        syncReady: true,
        modelReady: true,
      }),
    ).toBeFalse()

    expect(
      shouldAutoSubmitInitialPrompt({
        sessionID: "ses_1",
        autoSubmit: false,
        initialPromptInput: "count lines",
        currentInput: "count lines",
        syncReady: true,
        modelReady: true,
      }),
    ).toBeFalse()
  })
})
