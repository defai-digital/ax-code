import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { NamedError } from "@ax-code/util/error"
import { APICallError } from "ai"
import { SessionRetry } from "../../src/session/retry"
import { MessageV2 } from "../../src/session/message-v2"
import { ProviderID } from "../../src/provider/schema"

const providerID = ProviderID.make("test")
const MAX_RETRY_HEADER_DELAY_MS = 30_000

function apiError(headers?: Record<string, string>): MessageV2.APIError {
  return new MessageV2.APIError({
    message: "boom",
    isRetryable: true,
    responseHeaders: headers,
  }).toObject() as MessageV2.APIError
}

function wrap(message: unknown): ReturnType<NamedError["toObject"]> {
  return { data: { message } } as ReturnType<NamedError["toObject"]>
}

function concurrencyError(headers?: Record<string, string>): MessageV2.APIError {
  const message = "pool concurrent request limit exceeded"
  return new MessageV2.APIError({
    message,
    isRetryable: true,
    statusCode: 429,
    responseHeaders: headers,
    responseBody: JSON.stringify({
      error: {
        code: "concurrency_limit_exceeded",
        message,
        type: "rate_limit_error",
      },
    }),
  }).toObject() as MessageV2.APIError
}

describe("session.retry.delay", () => {
  test("caps delay at 30 seconds when headers missing (with jitter)", () => {
    const error = apiError()
    // Jitter adds +/-25% variance, so check that each delay falls within
    // the expected range around the base exponential value.
    const bases = [2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000, 30000]
    const delays = Array.from({ length: 10 }, (_, index) => SessionRetry.delay(index + 1, error))
    for (let i = 0; i < bases.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(Math.round(bases[i] * 0.75))
      expect(delays[i]).toBeLessThanOrEqual(Math.round(bases[i] * 1.25))
    }
  })

  test("prefers retry-after-ms when shorter than exponential", () => {
    const error = apiError({ "retry-after-ms": "1500" })
    expect(SessionRetry.delay(4, error)).toBe(1500)
  })

  test("uses retry-after seconds when reasonable", () => {
    const error = apiError({ "retry-after": "30" })
    expect(SessionRetry.delay(3, error)).toBe(30000)
  })

  test("accepts http-date retry-after values", () => {
    const date = new Date(Date.now() + 20000).toUTCString()
    const error = apiError({ "retry-after": date })
    const d = SessionRetry.delay(1, error)
    expect(d).toBeGreaterThanOrEqual(19000)
    expect(d).toBeLessThanOrEqual(20000)
  })

  test("ignores invalid retry hints", () => {
    const error = apiError({ "retry-after": "not-a-number" })
    const d = SessionRetry.delay(1, error)
    // Falls through to exponential with jitter (+/-25% of 2000)
    expect(d).toBeGreaterThanOrEqual(1500)
    expect(d).toBeLessThanOrEqual(2500)
  })

  test("normalizes malformed retry attempts to the first retry window", () => {
    for (const attempt of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      const delay = SessionRetry.delay(attempt, apiError())
      expect(Number.isFinite(delay)).toBe(true)
      expect(delay).toBeGreaterThanOrEqual(1500)
      expect(delay).toBeLessThanOrEqual(2500)
    }
  })

  test("ignores partial or negative numeric retry hints", () => {
    const partialSeconds = SessionRetry.delay(1, apiError({ "retry-after": "1abc" }))
    expect(partialSeconds).toBeGreaterThanOrEqual(1500)
    expect(partialSeconds).toBeLessThanOrEqual(2500)

    const negativeMs = SessionRetry.delay(1, apiError({ "retry-after-ms": "-5" }))
    expect(negativeMs).toBeGreaterThanOrEqual(1500)
    expect(negativeMs).toBeLessThanOrEqual(2500)
  })

  test("ignores non-decimal numeric retry hints", () => {
    const exponentialSeconds = SessionRetry.delay(1, apiError({ "retry-after": "1e3" }))
    expect(exponentialSeconds).toBeGreaterThanOrEqual(1500)
    expect(exponentialSeconds).toBeLessThanOrEqual(2500)

    const hexMs = SessionRetry.delay(1, apiError({ "retry-after-ms": "0x10" }))
    expect(hexMs).toBeGreaterThanOrEqual(1500)
    expect(hexMs).toBeLessThanOrEqual(2500)
  })

  test("accepts zero retry-after values", () => {
    expect(SessionRetry.delay(1, apiError({ "retry-after": "0" }))).toBe(0)
    expect(SessionRetry.delay(1, apiError({ "retry-after-ms": "0" }))).toBe(0)
  })

  test("ignores malformed date retry hints", () => {
    const error = apiError({ "retry-after": "Invalid Date String" })
    const d = SessionRetry.delay(1, error)
    expect(d).toBeGreaterThanOrEqual(1500)
    expect(d).toBeLessThanOrEqual(2500)
  })

  test("ignores past date retry hints", () => {
    const pastDate = new Date(Date.now() - 5000).toUTCString()
    const error = apiError({ "retry-after": pastDate })
    const d = SessionRetry.delay(1, error)
    expect(d).toBeGreaterThanOrEqual(1500)
    expect(d).toBeLessThanOrEqual(2500)
  })

  test("caps retry-after values at 30 seconds", () => {
    const error = apiError({ "retry-after": "50" })
    expect(SessionRetry.delay(1, error)).toBe(MAX_RETRY_HEADER_DELAY_MS)

    const longError = apiError({ "retry-after-ms": "700000" })
    expect(SessionRetry.delay(1, longError)).toBe(MAX_RETRY_HEADER_DELAY_MS)
  })

  test("concurrency limit does not collapse onto a 1-second retry-after", () => {
    const body = JSON.stringify({
      error: {
        code: "concurrency_limit_exceeded",
        message: "pool concurrent request limit exceeded",
        type: "rate_limit_error",
      },
    })
    const error = new MessageV2.APIError({
      message: "pool concurrent request limit exceeded",
      isRetryable: true,
      statusCode: 429,
      responseHeaders: { "retry-after": "1" },
      responseBody: body,
    }).toObject() as MessageV2.APIError

    const bases = [2000, 4000, 8000, 16000, 30000]
    for (let attempt = 1; attempt <= bases.length; attempt++) {
      const delay = SessionRetry.delay(attempt, error)
      const base = bases[attempt - 1]
      expect(delay).toBeGreaterThanOrEqual(Math.round(base * 0.75))
      expect(delay).toBeLessThanOrEqual(Math.round(base * 1.25))
    }
  })

  test("concurrency limit still honors a longer retry-after", () => {
    const trustFloor = new MessageV2.APIError({
      message: "pool concurrent request limit exceeded",
      isRetryable: true,
      statusCode: 429,
      responseHeaders: { "retry-after": "10" },
      responseBody: JSON.stringify({ error: { code: "concurrency_limit_exceeded" } }),
    }).toObject() as MessageV2.APIError
    expect(SessionRetry.delay(1, trustFloor)).toBe(10_000)

    const error = new MessageV2.APIError({
      message: "pool concurrent request limit exceeded",
      isRetryable: true,
      statusCode: 429,
      responseHeaders: { "retry-after": "30" },
      responseBody: JSON.stringify({ error: { code: "concurrency_limit_exceeded" } }),
    }).toObject() as MessageV2.APIError

    expect(SessionRetry.delay(1, error)).toBe(MAX_RETRY_HEADER_DELAY_MS)
  })

  test("a 1-second retry-after still wins for ordinary rate limits", () => {
    const error = new MessageV2.APIError({
      message: "request rate limit exceeded",
      isRetryable: true,
      statusCode: 429,
      responseHeaders: { "retry-after": "1" },
      responseBody: JSON.stringify({ error: { code: "request_rate_limit_exceeded" } }),
    }).toObject() as MessageV2.APIError

    expect(SessionRetry.delay(4, error)).toBe(1000)
  })

  test("caps future http-date retry-after values at 30 seconds", () => {
    const date = new Date(Date.now() + 120_000).toUTCString()
    const error = apiError({ "retry-after": date })
    expect(SessionRetry.delay(1, error)).toBe(MAX_RETRY_HEADER_DELAY_MS)
  })

  test("sleep caps delay to max 32-bit signed integer to avoid TimeoutOverflowWarning", async () => {
    const controller = new AbortController()

    const warnings: string[] = []
    const originalWarn = process.emitWarning
    process.emitWarning = (warning: string | Error) => {
      warnings.push(typeof warning === "string" ? warning : warning.message)
    }

    const promise = SessionRetry.sleep(2_560_914_000, controller.signal)
    controller.abort()

    try {
      await promise
    } catch {}

    process.emitWarning = originalWarn
    expect(warnings.some((w) => w.includes("TimeoutOverflowWarning"))).toBe(false)
  })
})

describe("session.retry.retryable", () => {
  beforeEach(() => {
    SessionRetry.resetNetworkCircuit()
  })

  test("parseRetryMessageJson decodes only JSON records", () => {
    expect(SessionRetry.parseRetryMessageJson(JSON.stringify({ code: "resource_exhausted" }))).toEqual({
      code: "resource_exhausted",
    })
    expect(SessionRetry.parseRetryMessageJson("[1,2]")).toBeUndefined()
    expect(SessionRetry.parseRetryMessageJson("not-json")).toBeUndefined()
    expect(SessionRetry.parseRetryMessageJson({ code: "resource_exhausted" })).toBeUndefined()
  })

  test("maps too_many_requests json messages", () => {
    const error = wrap(JSON.stringify({ type: "error", error: { type: "too_many_requests" } }))
    expect(SessionRetry.retryable(error)).toBe("Too Many Requests")
  })

  test("maps overloaded provider codes", () => {
    const error = wrap(JSON.stringify({ code: "resource_exhausted" }))
    expect(SessionRetry.retryable(error)).toBe("Provider is overloaded")
  })

  test("does not retry on unrecognized json error", () => {
    const error = wrap(JSON.stringify({ error: { message: "no_kv_space" } }))
    expect(SessionRetry.retryable(error)).toBeUndefined()
  })

  test("does not throw on numeric error codes", () => {
    const error = wrap(JSON.stringify({ type: "error", error: { code: 123 } }))
    const result = SessionRetry.retryable(error)
    expect(result).toBeUndefined()
  })

  test("returns undefined for non-json message", () => {
    const error = wrap("not-json")
    expect(SessionRetry.retryable(error)).toBeUndefined()
  })

  test("does not retry context overflow errors", () => {
    const error = new MessageV2.ContextOverflowError({
      message: "Input exceeds context window of this model",
      responseBody: '{"error":{"code":"context_length_exceeded"}}',
    }).toObject() as ReturnType<NamedError["toObject"]>

    expect(SessionRetry.retryable(error)).toBeUndefined()
  })

  test("retries Alibaba short-window quota exhaustion", () => {
    const message =
      "Alibaba rejected the request as exceeding short-window allocatable token quota. This is a per-request or TPS/TPM reservation limit, not total plan usage. ax-code treats this as retryable short-window throttling; if it persists, wait briefly or lower the per-request output cap via AX_CODE_ALIBABA_OUTPUT_TOKEN_MAX (e.g. 2048 or 1024). Details: https://www.alibabacloud.com/help/en/model-studio/error-code#token-limit"
    const error = new MessageV2.APIError({
      message,
      isRetryable: true,
      responseBody: JSON.stringify({ error: { code: "AllocatedQuotaExceeded" } }),
      metadata: {
        errorCode: "alibaba_token_plan_short_window_quota",
      },
    }).toObject() as ReturnType<NamedError["toObject"]>

    expect(SessionRetry.retryable(error)).toBe(message)
    const delay = SessionRetry.delay(1, error as MessageV2.APIError)
    expect(delay).toBeGreaterThanOrEqual(45_000)
    expect(delay).toBeLessThanOrEqual(75_000)
  })

  test("does not retry generic quota exhaustion without Alibaba short-window metadata", () => {
    const error = new MessageV2.APIError({
      message:
        "Allocated quota exceeded, please increase your quota limit. For details, see: https://www.alibabacloud.com/help/en/model-studio/error-code#token-limit",
      isRetryable: true,
      responseBody: JSON.stringify({ error: { code: "AllocatedQuotaExceeded" } }),
    }).toObject() as ReturnType<NamedError["toObject"]>

    expect(SessionRetry.retryable(error)).toBeUndefined()
  })

  test("does not retry token-plan account quota exhaustion", () => {
    const messageError = new MessageV2.APIError({
      message: "Your token-plan quota has been exhausted.",
      isRetryable: true,
      statusCode: 429,
    }).toObject() as ReturnType<NamedError["toObject"]>

    const codeError = new MessageV2.APIError({
      message: "insufficient_quota",
      isRetryable: true,
      statusCode: 429,
    }).toObject() as ReturnType<NamedError["toObject"]>

    expect(SessionRetry.retryable(messageError)).toBeUndefined()
    expect(SessionRetry.retryable(codeError)).toBeUndefined()
  })

  test("retries pool concurrency limits instead of treating them as quota", () => {
    const message = "pool concurrent request limit exceeded"
    const error = new MessageV2.APIError({
      message,
      isRetryable: true,
      statusCode: 429,
      responseBody: JSON.stringify({
        error: {
          code: "concurrency_limit_exceeded",
          message,
          type: "rate_limit_error",
        },
      }),
    }).toObject() as ReturnType<NamedError["toObject"]>

    expect(SessionRetry.retryable(error)).toBe(message)
  })

  test("retries concurrency limits even when the SDK marks them non-retryable", () => {
    const message = "pool concurrent request limit exceeded"
    const error = new MessageV2.APIError({
      message,
      isRetryable: false,
      statusCode: 429,
      responseBody: JSON.stringify({
        error: { code: "concurrency_limit_exceeded", message, type: "rate_limit_error" },
      }),
    }).toObject() as ReturnType<NamedError["toObject"]>

    expect(SessionRetry.retryable(error)).toBe(message)
  })

  test("retries Alibaba short-window quota even when marked non-retryable", () => {
    const message = "Alibaba short-window quota exceeded"
    const error = new MessageV2.APIError({
      message,
      isRetryable: false,
      responseBody: JSON.stringify({ error: { code: "AllocatedQuotaExceeded" } }),
      metadata: { errorCode: "alibaba_token_plan_short_window_quota" },
    }).toObject() as ReturnType<NamedError["toObject"]>

    expect(SessionRetry.retryable(error)).toBe(message)
  })

  test("still does not retry a non-concurrency error marked non-retryable", () => {
    const error = new MessageV2.APIError({
      message: "request rate limit exceeded",
      isRetryable: false,
      statusCode: 429,
    }).toObject() as ReturnType<NamedError["toObject"]>

    expect(SessionRetry.retryable(error)).toBeUndefined()
  })

  test("does not retry account quota exhaustion when only response body has the quota code", () => {
    const error = new MessageV2.APIError({
      message: "Too Many Requests",
      isRetryable: true,
      statusCode: 429,
      responseBody: JSON.stringify({
        error: {
          message: "Quota unavailable",
          code: "insufficient_quota",
        },
      }),
    }).toObject() as ReturnType<NamedError["toObject"]>

    expect(SessionRetry.retryable(error)).toBeUndefined()
  })

  test("opens network circuit after consecutive network failures", () => {
    const mk = () =>
      new MessageV2.APIError({
        message: "getaddrinfo ENOTFOUND api.example.com",
        isRetryable: true,
      }).toObject() as MessageV2.APIError

    expect(SessionRetry.retryable(mk())).toBe("getaddrinfo ENOTFOUND api.example.com")
    expect(SessionRetry.retryable(mk())).toBe("getaddrinfo ENOTFOUND api.example.com")
    // Third consecutive network failure opens the circuit.
    expect(SessionRetry.retryable(mk())).toBeUndefined()
    expect(SessionRetry.networkCircuitOpen()).toBe(true)
    // While open, further network errors fail fast.
    expect(SessionRetry.retryable(mk())).toBeUndefined()
  })

  test("recordNetworkSuccess clears the streak so intermittent failures never open the circuit", () => {
    const mk = () =>
      new MessageV2.APIError({
        message: "fetch failed",
        isRetryable: true,
      }).toObject() as MessageV2.APIError

    expect(SessionRetry.retryable(mk())).toBe("fetch failed")
    expect(SessionRetry.retryable(mk())).toBe("fetch failed")
    // A successful step between failures resets the streak.
    SessionRetry.recordNetworkSuccess()
    expect(SessionRetry.retryable(mk())).toBe("fetch failed")
    expect(SessionRetry.retryable(mk())).toBe("fetch failed")
    expect(SessionRetry.networkCircuitOpen()).toBe(false)
    // Only three consecutive failures without an intervening success open it.
    expect(SessionRetry.retryable(mk())).toBeUndefined()
    expect(SessionRetry.networkCircuitOpen()).toBe(true)
  })
})

describe("session.retry.concurrency budget", () => {
  const providerID = "test-provider"

  beforeEach(() => {
    SessionRetry.resetNetworkCircuit()
    vi.spyOn(Math, "random").mockReturnValue(0)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("concurrency streak accumulates and raises the delay ceiling", () => {
    const error = concurrencyError()
    // streak 1 -> 30s ceiling
    expect(SessionRetry.retryable(error, providerID)).toBe("pool concurrent request limit exceeded")
    expect(SessionRetry.delay(10, error, providerID)).toBe(30_000)
    // streak 2 -> 60s ceiling
    expect(SessionRetry.retryable(error, providerID)).toBe("pool concurrent request limit exceeded")
    expect(SessionRetry.delay(10, error, providerID)).toBe(60_000)
    // streak 3 -> still 60s ceiling
    expect(SessionRetry.retryable(error, providerID)).toBe("pool concurrent request limit exceeded")
    expect(SessionRetry.delay(10, error, providerID)).toBe(60_000)
    // streak 4 -> 120s ceiling
    expect(SessionRetry.retryable(error, providerID)).toBe("pool concurrent request limit exceeded")
    expect(SessionRetry.delay(10, error, providerID)).toBe(120_000)
  })

  test("recordConcurrencySuccess resets the streak back to the 30s ceiling", () => {
    const error = concurrencyError()
    for (let i = 0; i < 4; i++) SessionRetry.retryable(error, providerID)
    expect(SessionRetry.delay(10, error, providerID)).toBe(120_000)
    SessionRetry.recordConcurrencySuccess(providerID)
    expect(SessionRetry.delay(10, error, providerID)).toBe(30_000)
  })

  test("honors a Retry-After hint up to the raised cap for concurrency hits", () => {
    const error = concurrencyError()
    // Accumulate streak >= 2 so the raised header cap is in effect.
    SessionRetry.retryable(error, providerID)
    SessionRetry.retryable(error, providerID)

    const hint = concurrencyError({ "retry-after": "90" })
    expect(SessionRetry.delay(1, hint, providerID)).toBe(90_000)
  })

  test("still ignores a Retry-After hint shorter than the exponential floor", () => {
    const error = concurrencyError()
    for (let i = 0; i < 4; i++) SessionRetry.retryable(error, providerID)

    // attempt 3 -> exponential floor 8000; Retry-After: 5 (5000ms) is shorter
    const hint = concurrencyError({ "retry-after": "5" })
    expect(SessionRetry.delay(3, hint, providerID)).toBe(8000)
  })

  test("maxAttemptsFor returns 8 for concurrency errors and 5 otherwise", () => {
    expect(SessionRetry.maxAttemptsFor(concurrencyError())).toBe(8)
    expect(SessionRetry.maxAttemptsFor(apiError())).toBe(5)
    expect(SessionRetry.maxAttemptsFor(undefined)).toBe(5)
  })

  test("terminalErrorCode returns a stable code only for concurrency errors", () => {
    expect(SessionRetry.terminalErrorCode(concurrencyError())).toBe("provider_concurrency_exhausted")
    expect(SessionRetry.terminalErrorCode(apiError())).toBeUndefined()
  })
})

describe("session.message-v2.fromError", () => {
  beforeEach(() => {
    SessionRetry.resetNetworkCircuit()
  })

  test.concurrent(
    "converts ECONNRESET socket errors to retryable APIError",
    async () => {
      const error = Object.assign(new Error("The socket connection was closed unexpectedly"), {
        code: "ECONNRESET",
        syscall: "read",
      })

      const result = MessageV2.fromError(error, { providerID })

      expect(MessageV2.APIError.isInstance(result)).toBe(true)
      expect((result as MessageV2.APIError).data.isRetryable).toBe(true)
      expect((result as MessageV2.APIError).data.message).toBe("Connection reset by server")
      expect((result as MessageV2.APIError).data.metadata?.code).toBe("ECONNRESET")
      expect((result as MessageV2.APIError).data.metadata?.message).toInclude("socket connection")
    },
    15_000,
  )

  test("ECONNRESET socket error is retryable", () => {
    const error = new MessageV2.APIError({
      message: "Connection reset by server",
      isRetryable: true,
      metadata: { code: "ECONNRESET", message: "The socket connection was closed unexpectedly" },
    }).toObject() as MessageV2.APIError

    const retryable = SessionRetry.retryable(error)
    expect(retryable).toBeDefined()
    expect(retryable).toBe("Connection reset by server")
  })

  test("marks OpenAI 404 status codes as retryable", () => {
    const error = new APICallError({
      message: "boom",
      url: "https://api.openai.com/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 404,
      responseHeaders: { "content-type": "application/json" },
      responseBody: '{"error":"boom"}',
      isRetryable: false,
    })
    const result = MessageV2.fromError(error, { providerID: ProviderID.make("openai") }) as MessageV2.APIError
    expect(result.data.isRetryable).toBe(true)
  })
})
