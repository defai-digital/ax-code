import { describe, expect, test } from "bun:test"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { handlePromptLoopError, resolvePromptLoopErrorTransition } from "../../src/session/prompt-loop-errors"
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
  test("switches to fallback model for repeated retryable provider errors", async () => {
    const sessionID = SessionID.descending()
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const published: { sessionID: SessionID; message: string }[] = []

    const result = await handlePromptLoopError(
      {
        sessionID,
        currentModel: primaryModel,
        error: {
          name: "APIError",
          data: { statusCode: 429, message: "rate limited" },
        },
        consecutiveErrors: 2,
        step: 4,
      },
      {
        async findFallback(providerID) {
          expect(providerID).toBe(primaryModel.providerID)
          return fallbackModel
        },
        warn(message, fields) {
          warnings.push({ message, fields })
        },
        publishError(input) {
          published.push(input)
        },
      },
    )

    expect(result).toEqual({
      action: "fallback",
      fallbackModel,
      consecutiveErrors: 1,
    })
    expect(warnings).toEqual([
      {
        message: "switching to fallback provider",
        fields: {
          command: "session.prompt.loop",
          from: "primary/primary-model",
          to: "fallback/fallback-model",
          reason: "rate limited",
        },
      },
    ])
    expect(published).toEqual([
      {
        sessionID,
        message: "Provider primary failed: rate limited. Switching to fallback/fallback-model.",
      },
    ])
  })

  test("publishes stop errors when the consecutive error limit is reached", async () => {
    const sessionID = SessionID.descending()
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const published: { sessionID: SessionID; message: string }[] = []

    const result = await handlePromptLoopError(
      {
        sessionID,
        currentModel: primaryModel,
        error: new Error("stuck"),
        consecutiveErrors: 3,
        step: 8,
      },
      {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
        publishError(input) {
          published.push(input)
        },
      },
    )

    expect(result).toEqual({ action: "stop", reason: "error", consecutiveErrors: 3 })
    expect(warnings.map((entry) => entry.message)).toEqual([
      "consecutive error",
      "too many consecutive errors, stopping",
    ])
    expect(warnings[0]?.fields).toMatchObject({
      command: "session.prompt.loop",
      status: "error",
      errorCode: "CONSECUTIVE_ERROR",
      consecutiveErrors: 3,
      step: 8,
      sessionID,
    })
    expect(warnings[1]?.fields).toMatchObject({
      command: "session.prompt.loop",
      status: "error",
      errorCode: "MAX_CONSECUTIVE_ERRORS",
      consecutiveErrors: 3,
      sessionID,
    })
    expect(published).toHaveLength(1)
    expect(published[0]?.sessionID).toBe(sessionID)
    expect(published[0]?.message).toContain("3 consecutive errors")
  })

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
