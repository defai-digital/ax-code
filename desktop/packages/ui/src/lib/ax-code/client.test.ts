import { describe, expect, test } from "vitest"

import { formatPromptSendError } from "./client"

describe("formatPromptSendError", () => {
  test("maps ProviderModelNotFoundError to an actionable message", () => {
    const body = JSON.stringify({
      status: 400,
      errorName: "InvalidRequestError",
      error: {
        data: { providerID: "alibaba-token-plan", modelID: "qwen3.7-plus", suggestions: [] },
        name: "ProviderModelNotFoundError",
      },
    })
    expect(formatPromptSendError(400, body)).toBe(
      "The selected model is no longer available. Please choose another model.",
    )
  })

  test("maps ProviderModelNotFoundError when the error name is at the top level", () => {
    const body = JSON.stringify({ name: "ProviderModelNotFoundError" })
    expect(formatPromptSendError(400, body)).toBe(
      "The selected model is no longer available. Please choose another model.",
    )
  })

  test("maps the real stale-model envelope (details.resource = providerModel)", () => {
    // This is the actual shape ax-code returns for a stale provider/model:
    // Provider.ModelNotFoundError is normalized to InvalidRequestError with
    // details.resource = "providerModel" (server/error.ts), NOT a
    // ProviderModelNotFoundError name.
    const body = JSON.stringify({
      name: "InvalidRequestError",
      message: "Provider model not found",
      status: 400,
      details: { resource: "providerModel" },
    })
    expect(formatPromptSendError(400, body)).toBe(
      "The selected model is no longer available. Please choose another model.",
    )
  })

  test("maps the stale-model envelope by message when details are absent", () => {
    const body = JSON.stringify({ name: "InvalidRequestError", message: "Provider model not found" })
    expect(formatPromptSendError(400, body)).toBe(
      "The selected model is no longer available. Please choose another model.",
    )
  })

  test("falls back to the generic suffix form for other structured 400s", () => {
    const body = JSON.stringify({ name: "InvalidRequestError", message: "Invalid request" })
    expect(formatPromptSendError(400, body)).toBe(`Failed to send message (400): ${body}`)
  })

  test("falls back to the generic suffix form for non-JSON bodies", () => {
    expect(formatPromptSendError(500, "upstream down")).toBe("Failed to send message (500): upstream down")
  })

  test("returns a bare status message when the body is empty", () => {
    expect(formatPromptSendError(400, "")).toBe("Failed to send message (400)")
    expect(formatPromptSendError(400, "   ")).toBe("Failed to send message (400)")
  })
})
