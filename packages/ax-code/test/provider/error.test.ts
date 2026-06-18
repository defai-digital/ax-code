import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderError } from "../../src/provider/error"
import { ProviderID } from "../../src/provider/schema"

describe("provider error decoding", () => {
  test("decodes JSON records from strings and objects", () => {
    expect(ProviderError.parseJsonRecord(JSON.stringify({ type: "error" }))).toEqual({ type: "error" })
    expect(ProviderError.parseJsonRecord({ type: "error" })).toEqual({ type: "error" })
    expect(ProviderError.parseJsonRecord("[1,2]")).toBeUndefined()
    expect(ProviderError.parseJsonRecord("not json")).toBeUndefined()
  })

  test("extracts common provider response body messages", () => {
    expect(ProviderError.responseBodyErrorMessage(JSON.stringify({ message: "top-level" }))).toBe("top-level")
    expect(ProviderError.responseBodyErrorMessage(JSON.stringify({ error: { message: "nested" } }))).toBe("nested")
    expect(ProviderError.responseBodyErrorMessage(JSON.stringify({ error: "direct" }))).toBe("direct")
    expect(ProviderError.responseBodyErrorMessage("<html>bad gateway</html>")).toBeUndefined()
  })

  test("includes decoded response body messages in API call errors", () => {
    const parsed = ProviderError.parseAPICallError({
      providerID: ProviderID.make("openai"),
      error: new APICallError({
        message: "Bad Request",
        url: "https://example.com",
        requestBodyValues: {},
        statusCode: 400,
        responseHeaders: { "content-type": "application/json" },
        responseBody: JSON.stringify({ error: { message: "Invalid model" } }),
        isRetryable: false,
      }),
    })

    expect(parsed).toMatchObject({
      type: "api_error",
      message: "Bad Request: Invalid model",
      statusCode: 400,
      isRetryable: false,
    })
  })

  test("parses stream errors with non-JSON-native response body values", () => {
    const body: Record<string, unknown> = {
      type: "error",
      error: {
        code: "context_length_exceeded",
        sequence: 1n,
      },
    }
    body.self = body

    const parsed = ProviderError.parseStreamError(body)

    expect(parsed).toMatchObject({
      type: "context_overflow",
      responseBody: '{"type":"error","error":{"code":"context_length_exceeded","sequence":"1"},"self":"[Circular]"}',
    })
  })

  test("parses stream errors when response body serialization throws non-printable values", () => {
    const broken = function brokenThrowable() {
      return undefined
    }
    Object.defineProperty(broken, Symbol.toPrimitive, {
      value() {
        throw new Error("cannot stringify")
      },
    })
    const body = {
      type: "error",
      error: {
        code: "context_length_exceeded",
      },
      toJSON() {
        throw broken
      },
    }

    const parsed = ProviderError.parseStreamError(body)

    expect(parsed).toMatchObject({
      type: "context_overflow",
      responseBody: '{"type":"error","error":{"message":"Unknown serialization error"}}',
    })
  })

  test("ignores non-error stream records with non-JSON-native response body values", () => {
    const body: Record<string, unknown> = { type: "message", sequence: 1n }
    body.self = body

    expect(() => ProviderError.parseStreamError(body)).not.toThrow()
    expect(ProviderError.parseStreamError(body)).toBeUndefined()
  })
})
