import { describe, expect, test } from "vitest"
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
  test("switches to fallback model for repeated retryable provider errors without publishing a terminal error", async () => {
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
        async findFallback(providerID, preferredModelID, excludedProviderIDs) {
          expect(providerID).toBe(primaryModel.providerID)
          expect(preferredModelID).toBe(primaryModel.modelID)
          expect(Array.from(excludedProviderIDs ?? [])).toEqual([])
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
    expect(published).toEqual([])
  })

  test("switches to fallback model immediately for provider quota exhaustion without publishing a terminal error", async () => {
    const sessionID = SessionID.descending()
    const published: { sessionID: SessionID; message: string }[] = []

    const result = await handlePromptLoopError(
      {
        sessionID,
        currentModel: primaryModel,
        error: {
          name: "APIError",
          data: {
            statusCode: 429,
            message: "Your token-plan quota has been exhausted.",
          },
        },
        consecutiveErrors: 1,
        step: 1,
      },
      {
        async findFallback(providerID, preferredModelID) {
          expect(providerID).toBe(primaryModel.providerID)
          expect(preferredModelID).toBe(primaryModel.modelID)
          return fallbackModel
        },
        warn() {},
        publishError(input) {
          published.push(input)
        },
      },
    )

    expect(result).toEqual({
      action: "fallback",
      fallbackModel,
      consecutiveErrors: 0,
    })
    expect(published).toEqual([])
  })

  test("passes previously failed providers to fallback lookup", async () => {
    const previousFallbackProvider = ProviderID.make("previous-fallback")
    const sessionID = SessionID.descending()

    const result = await handlePromptLoopError(
      {
        sessionID,
        currentModel: fallbackModel,
        error: {
          name: "APIError",
          data: { statusCode: 429, message: "Your token-plan quota has been exhausted." },
        },
        consecutiveErrors: 1,
        step: 2,
        failedProviderIDs: [primaryModel.providerID, previousFallbackProvider],
      },
      {
        async findFallback(providerID, preferredModelID, excludedProviderIDs) {
          expect(providerID).toBe(fallbackModel.providerID)
          expect(preferredModelID).toBe(fallbackModel.modelID)
          expect(Array.from(excludedProviderIDs ?? [])).toEqual([primaryModel.providerID, previousFallbackProvider])
          return undefined
        },
        warn() {},
        publishError() {},
      },
    )

    expect(result).toEqual({
      action: "stop",
      reason: "error",
      consecutiveErrors: 1,
    })
  })

  test("stops immediately when account failure has no fallback provider", async () => {
    const sessionID = SessionID.descending()
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const published: { sessionID: SessionID; message: string }[] = []

    const result = await handlePromptLoopError(
      {
        sessionID,
        currentModel: primaryModel,
        error: {
          name: "APIError",
          data: { statusCode: 429, message: "Your token-plan quota has been exhausted." },
        },
        consecutiveErrors: 1,
        step: 1,
      },
      {
        async findFallback() {
          return undefined
        },
        warn(message, fields) {
          warnings.push({ message, fields })
        },
        publishError(input) {
          published.push(input)
        },
      },
    )

    expect(result).toEqual({ action: "stop", reason: "error", consecutiveErrors: 1 })
    expect(warnings).toEqual([
      {
        message: "no fallback provider available",
        fields: {
          command: "session.prompt.loop",
          status: "error",
          errorCode: "PROVIDER_FALLBACK_UNAVAILABLE",
          providerID: primaryModel.providerID,
          reason: "Your token-plan quota has been exhausted.",
        },
      },
    ])
    expect(published).toEqual([
      {
        sessionID,
        message: "Provider primary failed: Your token-plan quota has been exhausted. No fallback provider available.",
      },
    ])
  })

  test("stops immediately for non-retryable provider errors", async () => {
    const sessionID = SessionID.descending()
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const published: { sessionID: SessionID; message: string }[] = []

    const result = await handlePromptLoopError(
      {
        sessionID,
        currentModel: primaryModel,
        error: {
          name: "APIError",
          data: {
            statusCode: 400,
            message: "request did not terminate",
            isRetryable: false,
          },
        },
        consecutiveErrors: 1,
        step: 1,
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

    expect(result).toEqual({ action: "stop", reason: "error", consecutiveErrors: 1 })
    expect(warnings).toEqual([
      {
        message: "non-retryable provider error, stopping",
        fields: {
          command: "session.prompt.loop",
          status: "error",
          errorCode: "NON_RETRYABLE_PROVIDER_ERROR",
          consecutiveErrors: 1,
          step: 1,
          sessionID,
        },
      },
    ])
    expect(published).toEqual([
      {
        sessionID,
        message: "request did not terminate",
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

  test("resets consecutive errors and preserves fallback override after a successful turn", async () => {
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
      fallbackModelOverride: fallbackModel,
      resetCachedModel: false,
    })
  })

  test("clears fallback override when no fallback was active", async () => {
    const transition = await resolvePromptLoopErrorTransition({
      sessionID: SessionID.descending(),
      currentModel: primaryModel,
      error: undefined,
      consecutiveErrors: 0,
      fallbackModelOverride: undefined,
      step: 5,
    })

    expect(transition).toEqual({
      action: "continue",
      consecutiveErrors: 0,
      fallbackModelOverride: undefined,
      resetCachedModel: false,
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
