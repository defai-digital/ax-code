import { beforeEach, describe, expect, test } from "vitest"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionRetry } from "../../src/session/retry"
import { ProviderID } from "../../src/provider/schema"

const providerID = ProviderID.make("stream-regression")

describe("gateway stream interruption classification", () => {
  beforeEach(() => SessionRetry.resetNetworkCircuit(providerID))
  for (const message of ["upstream stream failed", "upstream stream timed out"]) {
    for (const shape of ["string", "error"] as const) {
      test(`${shape}: ${message} enters bounded provider retry`, () => {
        const input = shape === "string" ? message : new Error(message)
        const result = MessageV2.fromError(input, { providerID })
        expect(result).toMatchObject({
          name: "APIError",
          data: { message: `Network error: ${message}`, isRetryable: true, metadata: { message } },
        })
        expect(SessionRetry.retryable(result, providerID)).toBeDefined()
      })
    }
    test(`explicit terminal classification wins for ${message}`, () => {
      const input = Object.assign(new Error(message), { isRetryable: false })
      const result = MessageV2.fromError(input, { providerID })
      expect(result).toMatchObject({ name: "APIError", data: { isRetryable: false } })
      expect(SessionRetry.retryable(result, providerID)).toBeUndefined()
    })
  }
  test("undici terminated with an HTTP/2 stream reset cause enters bounded provider retry", () => {
    // Shape observed when the gateway reset the stream mid-response:
    // TypeError: terminated, cause ERR_HTTP2_STREAM_ERROR / NGHTTP2_INTERNAL_ERROR.
    const cause = Object.assign(new Error("Stream closed with error code NGHTTP2_INTERNAL_ERROR"), {
      code: "ERR_HTTP2_STREAM_ERROR",
    })
    const input = new TypeError("terminated", { cause })
    const result = MessageV2.fromError(input, { providerID })
    expect(result).toMatchObject({
      name: "APIError",
      data: {
        message: "Network error: terminated (Stream closed with error code NGHTTP2_INTERNAL_ERROR)",
        isRetryable: true,
      },
    })
    expect(SessionRetry.retryable(result, providerID)).toBeDefined()
  })
  for (const message of ["terminated", "other side closed"]) {
    test(`bare undici TypeError ${message} enters bounded provider retry`, () => {
      const result = MessageV2.fromError(new TypeError(message), { providerID })
      expect(result).toMatchObject({ name: "APIError", data: { isRetryable: true } })
      expect(SessionRetry.retryable(result, providerID)).toBeDefined()
    })
  }
  test("socket cause code enters bounded provider retry", () => {
    const cause = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" })
    const result = MessageV2.fromError(new TypeError("fetch interrupted", { cause }), { providerID })
    expect(result).toMatchObject({ name: "APIError", data: { isRetryable: true } })
  })
  for (const message of [
    "session terminated",
    "upstream stream exceeded response limit",
    "upstream denied the request",
    "unexpected upstream stream failed validation",
    "stream failed",
  ]) {
    test(`does not turn unrelated failure into retry: ${message}`, () => {
      const result = MessageV2.fromError(message, { providerID })
      expect(SessionRetry.retryable(result, providerID)).toBeUndefined()
    })
  }
})
