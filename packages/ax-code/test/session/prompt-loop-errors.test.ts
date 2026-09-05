import { describe, expect, test } from "vitest"
import path from "node:path"
import { readFile } from "node:fs/promises"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { handlePromptLoopError, resolvePromptLoopErrorTransition } from "../../src/session/prompt-loop-errors"
import { isLoopbackBaseURL } from "../../src/session/prompt-provider-fallback"
import { SessionID } from "../../src/session/schema"
import { MessageV2 } from "../../src/session/message-v2"

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
      notice: "Provider primary failed: rate limited. Switching to fallback/fallback-model.",
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
      notice:
        "Provider primary failed: Your token-plan quota has been exhausted. Switching to fallback/fallback-model.",
      consecutiveErrors: 0,
    })
    expect(published).toEqual([])
  })

  // Issue #394: an expired/invalid credential must not silently fall back to
  // another provider — the switch comes back with a user-facing notice the
  // caller persists on the fallback turn's assistant message.
  test("surfaces a user-facing notice when auth failure switches provider", async () => {
    const sessionID = SessionID.descending()
    const published: { sessionID: SessionID; message: string }[] = []

    const result = await handlePromptLoopError(
      {
        sessionID,
        currentModel: primaryModel,
        error: {
          name: "APIError",
          data: { statusCode: 401, message: "unauthorized" },
        },
        consecutiveErrors: 1,
        step: 1,
      },
      {
        async findFallback() {
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
      notice: "Provider primary failed: unauthorized. Switching to fallback/fallback-model.",
      consecutiveErrors: 0,
    })
    // The notice is NOT a terminal error: nothing is published to
    // session.error, so clients never render it as a failed turn.
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

  test("stops immediately for an explicitly non-retryable CLI error", async () => {
    const sessionID = SessionID.descending()
    const published: { sessionID: SessionID; message: string }[] = []

    const result = await handlePromptLoopError(
      {
        sessionID,
        currentModel: primaryModel,
        error: MessageV2.fromError(
          Object.assign(new Error("The selected model requires a newer Codex CLI"), { isRetryable: false }),
          { providerID: primaryModel.providerID },
        ),
        consecutiveErrors: 1,
        step: 1,
      },
      {
        warn() {},
        publishError(input) {
          published.push(input)
        },
      },
    )

    expect(result).toEqual({ action: "stop", reason: "error", consecutiveErrors: 1 })
    expect(published).toEqual([{ sessionID, message: "The selected model requires a newer Codex CLI" }])
  })

  test("stops an AX Engine stream stall without replaying the oversized local request", async () => {
    const sessionID = SessionID.descending()
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const published: { sessionID: SessionID; message: string }[] = []

    const result = await handlePromptLoopError(
      {
        sessionID,
        currentModel: {
          providerID: ProviderID.make("ax-engine"),
          modelID: ModelID.make("qwen3.8-27b-axq-6bit"),
        },
        error: {
          name: "UnknownError",
          data: { message: "Model stream stalled — no data from ax-engine/model for 900s" },
        },
        consecutiveErrors: 1,
        step: 4,
      },
      {
        async findFallback() {
          throw new Error("fallback lookup must not run")
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
        message: "local engine stream stalled, stopping without replay",
        fields: expect.objectContaining({ errorCode: "AX_ENGINE_STREAM_STALLED", sessionID }),
      },
    ])
    expect(published).toEqual([
      {
        sessionID,
        message: expect.stringContaining("was not replayed automatically"),
      },
    ])
  })

  test("stops once with the cap's own message when a cumulative autonomous cap trips", async () => {
    // Cumulative caps (files/lines; steps until the next continuation) make
    // every subsequent tool call throw, so retrying can never recover —
    // previously this churned to a generic "too many consecutive errors".
    const sessionID = SessionID.descending()
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const published: { sessionID: SessionID; message: string; code?: string }[] = []
    const capMessage =
      "Autonomous line-change cap reached: 52941/5000 lines modified. Set experimental.autonomous_caps.lines to raise."

    const result = await handlePromptLoopError(
      {
        sessionID,
        currentModel: primaryModel,
        // Serialized shape, as assistant message errors arrive in the loop.
        error: {
          name: "AutonomousLimitExceededError",
          data: { kind: "lines", current: 52941, limit: 5000, message: capMessage },
        },
        consecutiveErrors: 1,
        step: 4,
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

    expect(result).toEqual({
      action: "stop",
      reason: "error",
      consecutiveErrors: 1,
      stopCode: "LINE_CHANGE_LIMIT",
    })
    expect(warnings).toEqual([
      {
        message: "autonomous cap exceeded, stopping without retry",
        fields: {
          command: "session.prompt.loop",
          status: "error",
          errorCode: "AUTONOMOUS_CAP_EXCEEDED",
          consecutiveErrors: 1,
          step: 4,
          sessionID,
          stopCode: "LINE_CHANGE_LIMIT",
        },
      },
    ])
    expect(published).toEqual([{ sessionID, message: capMessage, code: "LINE_CHANGE_LIMIT" }])
  })

  test("per-tool cap trips fall through to ordinary error handling (counters reset each turn)", async () => {
    const sessionID = SessionID.descending()
    const published: { sessionID: SessionID; message: string }[] = []

    const result = await handlePromptLoopError(
      {
        sessionID,
        currentModel: primaryModel,
        error: {
          name: "AutonomousLimitExceededError",
          data: {
            kind: "tool_calls",
            current: 51,
            limit: 50,
            message: 'Autonomous per-tool call cap reached for "bash": 51/50 calls.',
          },
        },
        consecutiveErrors: 1,
        step: 4,
      },
      {
        warn() {},
        publishError(input) {
          published.push(input)
        },
      },
    )

    expect(result).toEqual({ action: "continue", consecutiveErrors: 1 })
    expect(published).toEqual([])
  })

  test("blocked-path cap shapes remain recoverable so the model can choose another path", async () => {
    const sessionID = SessionID.descending()
    const published: { sessionID: SessionID; message: string }[] = []

    const result = await handlePromptLoopError(
      {
        sessionID,
        currentModel: primaryModel,
        error: {
          name: "AutonomousLimitExceededError",
          data: {
            kind: "blocked_path",
            current: 0,
            limit: 0,
            message: "Choose a path outside the protected list.",
          },
        },
        consecutiveErrors: 1,
        step: 4,
      },
      {
        warn() {},
        publishError(input) {
          published.push(input)
        },
      },
    )

    expect(result).toEqual({ action: "continue", consecutiveErrors: 1 })
    expect(published).toEqual([])
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

  test("stops as aborted without consuming the error budget when a cancel lands mid-turn", async () => {
    const transition = await resolvePromptLoopErrorTransition(
      {
        sessionID: SessionID.descending(),
        currentModel: primaryModel,
        // Serialized shape as persisted on the assistant message.
        error: { name: "MessageAbortedError", data: { message: "This operation was aborted" } },
        consecutiveErrors: 2,
        fallbackModelOverride: fallbackModel,
        step: 6,
      },
      {
        handleError: async () => {
          throw new Error("handlePromptLoopError must not run for an aborted turn")
        },
      },
    )

    expect(transition).toEqual({
      action: "stop",
      reason: "aborted",
      consecutiveErrors: 2,
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
          return {
            action: "fallback",
            fallbackModel,
            notice: "Provider primary failed: rate limited. Switching to fallback/fallback-model.",
            consecutiveErrors: 1,
          }
        },
      },
    )

    expect(transition).toEqual({
      action: "retry",
      consecutiveErrors: 1,
      fallbackModelOverride: fallbackModel,
      fallbackNotice: "Provider primary failed: rate limited. Switching to fallback/fallback-model.",
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

describe("local provider fallback privacy guard", () => {
  const localModel = {
    providerID: "ax-engine" as ProviderID,
    modelID: "ornith-35b-axq-6bit" as ModelID,
  }

  test("never looks up a remote fallback for a local provider; transient errors fall through to retry", async () => {
    const sessionID = SessionID.descending()
    const warnings: { message: string; fields: Record<string, unknown> }[] = []
    const published: { sessionID: SessionID; message: string }[] = []

    const result = await handlePromptLoopError(
      {
        sessionID,
        currentModel: localModel,
        error: {
          name: "APIError",
          data: { statusCode: 429, message: "server is at its maximum concurrent engine-job limit; retry shortly" },
        },
        consecutiveErrors: 2,
        step: 3,
      },
      {
        async isLocal(providerID) {
          expect(providerID).toBe(localModel.providerID)
          return true
        },
        async findFallback() {
          throw new Error("fallback lookup must not run for a local provider")
        },
        warn(message, fields) {
          warnings.push({ message, fields })
        },
        publishError(input) {
          published.push(input)
        },
      },
    )

    // Not a terminal account failure: ordinary consecutive-error handling
    // decides (here: keep retrying the local engine).
    expect(result).toEqual({ action: "continue", consecutiveErrors: 2 })
    expect(published).toEqual([])
    expect(warnings[0]?.message).toBe("local provider failed, skipping remote fallback (data privacy)")
  })

  test("stops with a privacy explanation for terminal local provider failures instead of falling back", async () => {
    const sessionID = SessionID.descending()
    const published: { sessionID: SessionID; message: string }[] = []

    const result = await handlePromptLoopError(
      {
        sessionID,
        currentModel: localModel,
        error: {
          name: "APIError",
          data: { statusCode: 401, message: "unauthorized" },
        },
        consecutiveErrors: 1,
        step: 1,
      },
      {
        async isLocal() {
          return true
        },
        async findFallback() {
          throw new Error("fallback lookup must not run for a local provider")
        },
        warn() {},
        publishError(input) {
          published.push(input)
        },
      },
    )

    expect(result.action).toBe("stop")
    expect(published).toHaveLength(1)
    expect(published[0]!.message).toContain("Provider ax-engine failed: unauthorized.")
    expect(published[0]!.message).toContain("local provider")
    expect(published[0]!.message).not.toContain("Switching to")
  })

  test("non-local providers still fall back as before", async () => {
    const result = await handlePromptLoopError(
      {
        sessionID: SessionID.descending(),
        currentModel: primaryModel,
        error: {
          name: "APIError",
          data: { statusCode: 429, message: "rate limited" },
        },
        consecutiveErrors: 2,
        step: 4,
      },
      {
        async isLocal() {
          return false
        },
        async findFallback() {
          return fallbackModel
        },
        warn() {},
        publishError() {},
      },
    )

    expect(result).toEqual({
      action: "fallback",
      fallbackModel,
      notice: "Provider primary failed: rate limited. Switching to fallback/fallback-model.",
      consecutiveErrors: 1,
    })
  })
})

describe("isLoopbackBaseURL", () => {
  test("detects loopback URLs", () => {
    expect(isLoopbackBaseURL("http://127.0.0.1:31418/v1")).toBe(true)
    expect(isLoopbackBaseURL("http://localhost:11434/v1")).toBe(true)
    expect(isLoopbackBaseURL("http://[::1]:8080")).toBe(true)
  })

  test("rejects remote and malformed URLs", () => {
    expect(isLoopbackBaseURL("https://api.z.ai/api/coding/paas/v4")).toBe(false)
    expect(isLoopbackBaseURL("https://api.openai.com/v1")).toBe(false)
    expect(isLoopbackBaseURL("not a url")).toBe(false)
    expect(isLoopbackBaseURL(undefined)).toBe(false)
    expect(isLoopbackBaseURL("")).toBe(false)
  })
})

describe("fallback notice rendering (#415)", () => {
  test("per-hop failure messages are log-only; the loop persists one clean notice", async () => {
    const src = await readFile(path.join(import.meta.dirname, "../../src/session/prompt-impl.ts"), "utf-8")
    // The loop builds the user-facing line from the shared helper instead of
    // accumulating each hop's raw "Provider ... failed" switch message.
    expect(src).toContain("providerFallbackNotice({")
    expect(src).not.toContain("pendingFallbackNotice")
    expect(src).toContain("fallbackNoticeOrigin ??= lastUser.model.providerID")
    // The transition still carries the per-hop switch message, but only for
    // logging — handlePromptLoopError emits it at WARN via deps.warn.
    const errorsSrc = await readFile(path.join(import.meta.dirname, "../../src/session/prompt-loop-errors.ts"), "utf-8")
    expect(errorsSrc).toContain('log.warn)("switching to fallback provider"')
  })
})
