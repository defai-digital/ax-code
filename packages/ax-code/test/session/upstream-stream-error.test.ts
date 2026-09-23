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
  for (const message of [
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
