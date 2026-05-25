import { describe, expect, test } from "bun:test"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { resolvePromptLoopErrorTransition } from "../../src/session/prompt-loop-errors"
import { SessionID } from "../../src/session/schema"

const primaryModel = {
  providerID: "primary" as ProviderID,
  modelID: "primary-model" as ModelID,
}

const fallbackModel = {
  providerID: "fallback" as ProviderID,
  modelID: "fallback-model" as ModelID,
}

describe("prompt loop error transitions", () => {
  test("resets fallback state and cached model after a successful turn", async () => {
    const transition = await resolvePromptLoopErrorTransition({
      sessionID: SessionID.descending(),
      currentModel: primaryModel,
      error: undefined,
      consecutiveErrors: 3,
      fallbackModelOverride: fallbackModel,
      step: 4,
    })

    expect(transition).toEqual({
      action: "continue",
      consecutiveErrors: 0,
      fallbackModelOverride: undefined,
      resetCachedModel: true,
    })
  })

  test("increments consecutive errors before delegating error handling", async () => {
    const transition = await resolvePromptLoopErrorTransition(
      {
        sessionID: SessionID.descending(),
        currentModel: primaryModel,
        error: new Error("provider failed"),
        consecutiveErrors: 2,
        fallbackModelOverride: fallbackModel,
        step: 5,
      },
      {
        async handleError(input) {
          expect(input.consecutiveErrors).toBe(3)
          expect(input.currentModel).toEqual(primaryModel)
          return { action: "continue", consecutiveErrors: input.consecutiveErrors }
        },
      },
    )

    expect(transition).toEqual({
      action: "continue",
      consecutiveErrors: 3,
      fallbackModelOverride: fallbackModel,
      resetCachedModel: false,
    })
  })

  test("maps fallback handling to a retry transition that clears the cached model", async () => {
    const transition = await resolvePromptLoopErrorTransition(
      {
        sessionID: SessionID.descending(),
        currentModel: primaryModel,
        error: new Error("rate limited"),
        consecutiveErrors: 1,
        fallbackModelOverride: undefined,
        step: 2,
      },
      {
        async handleError() {
          return { action: "fallback", fallbackModel, consecutiveErrors: 1 }
        },
      },
    )

    expect(transition).toEqual({
      action: "retry",
      consecutiveErrors: 1,
      fallbackModelOverride: fallbackModel,
      resetCachedModel: true,
    })
  })

  test("surfaces stop transitions without clearing model cache state", async () => {
    const transition = await resolvePromptLoopErrorTransition(
      {
        sessionID: SessionID.descending(),
        currentModel: primaryModel,
        error: new Error("stuck"),
        consecutiveErrors: 9,
        fallbackModelOverride: fallbackModel,
        step: 10,
      },
      {
        async handleError() {
          return { action: "stop", reason: "error", consecutiveErrors: 10 }
        },
      },
    )

    expect(transition).toEqual({
      action: "stop",
      reason: "error",
      consecutiveErrors: 10,
      fallbackModelOverride: fallbackModel,
      resetCachedModel: false,
    })
  })
})
