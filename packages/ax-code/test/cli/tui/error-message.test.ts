import { describe, expect, test } from "bun:test"
import {
  errorPayloadMessage,
  responseErrorMessage,
  textErrorMessage,
  unknownErrorMessage,
} from "../../../src/cli/cmd/tui/util/error-message"

describe("tui error message decoding", () => {
  test("extracts supported error payload message shapes", () => {
    expect(errorPayloadMessage({ message: "top-level message" })).toBe("top-level message")
    expect(errorPayloadMessage({ error: "top-level error" })).toBe("top-level error")
    expect(errorPayloadMessage({ error: { message: "nested error message" } })).toBe("nested error message")
    expect(errorPayloadMessage({ error: { data: { message: "nested data message" } } })).toBe("nested data message")
    expect(errorPayloadMessage({ data: { message: "direct data message" } })).toBe("direct data message")
  })

  test("ignores empty and non-string payload messages", () => {
    expect(errorPayloadMessage({ message: "" })).toBeUndefined()
    expect(errorPayloadMessage({ error: { data: { message: 123 } } })).toBeUndefined()
    expect(errorPayloadMessage(["not", "an", "object"])).toBeUndefined()
  })

  test("decodes response body text with raw text fallback", () => {
    expect(textErrorMessage(JSON.stringify({ error: { data: { message: "bad request" } } }))).toBe("bad request")
    expect(textErrorMessage("plain failure")).toBe("plain failure")
    expect(textErrorMessage("")).toBeUndefined()
  })

  test("formats response status when the body is unavailable", async () => {
    const message = await responseErrorMessage({
      status: 503,
      text: async () => {
        throw new Error("stream already consumed")
      },
    })
    expect(message).toBe("Request failed with status 503")
  })

  test("decodes standard server error envelopes from response bodies", async () => {
    const message = await responseErrorMessage({
      status: 409,
      text: async () =>
        JSON.stringify({
          name: "ServiceUnavailableError",
          message: "Super-Long requires autonomous mode or equivalent runtime guardrails.",
          status: 409,
        }),
    })
    expect(message).toBe("Super-Long requires autonomous mode or equivalent runtime guardrails.")
  })

  test("formats unknown errors for session event toasts", () => {
    expect(unknownErrorMessage({ data: { message: "session failed" } })).toBe("session failed")
    expect(unknownErrorMessage(undefined)).toBe("An error occurred")
    expect(unknownErrorMessage("plain error")).toBe("plain error")
  })
})
