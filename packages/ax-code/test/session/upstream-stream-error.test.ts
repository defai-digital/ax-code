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
  test("an AX Engine stream closed with terminated is not replayed by the processor", () => {
    // A local engine that sent only keep-alives and closed is dead or wedged;
    // the prompt loop stops it once (isAxEngineStreamStall) instead.
    const axEngine = ProviderID.make("ax-engine")
    for (const input of [
      new TypeError("terminated"),
      new TypeError("other side closed"),
      new TypeError("terminated", {
        cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
      }),
    ]) {
      const result = MessageV2.fromError(input, { providerID: axEngine })
      expect(result).toMatchObject({ name: "UnknownError", data: { message: input.message } })
      expect(SessionRetry.retryable(result, axEngine)).toBeUndefined()
    }
    // Connection-level failures to the engine keep their existing retry.
    const refused = MessageV2.fromError(
      new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
      }),
      { providerID: axEngine },
    )
    expect(refused).toMatchObject({ name: "APIError", data: { isRetryable: true } })
  })
  test("isReplayableNetworkError skips only the AX Engine stream close", () => {
    const terminated = new TypeError("terminated")
    expect(MessageV2.isReplayableNetworkError(terminated, providerID)).toBe(true)
    expect(MessageV2.isReplayableNetworkError(terminated, ProviderID.make("ax-engine"))).toBe(false)
    const reset = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })
    expect(MessageV2.isReplayableNetworkError(reset, ProviderID.make("ax-engine"))).toBe(true)
    expect(MessageV2.isReplayableNetworkError(new Error("stream disconnected"), providerID)).toBe(false)
  })
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
