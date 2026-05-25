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
})
