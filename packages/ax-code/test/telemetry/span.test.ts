import { afterEach, expect, test } from "vitest"
import { withSpanSync } from "../../src/telemetry/span"

afterEach(() => {
  delete process.env.AX_CODE_OTLP_ENDPOINT
})

test("withSpanSync runs fn exactly once and propagates its error when fn throws", () => {
  // Regression: the outer try/catch (meant only to fall back when the OTel
  // module itself is unavailable) used to also catch the rethrow from the
  // inner catch, causing `fn` to run a second time via `fn(noop)` — masking
  // the original error and double-executing any side effects.
  process.env.AX_CODE_OTLP_ENDPOINT = "https://1.1.1.1/v1/traces"

  let calls = 0
  const failure = new Error("boom")

  expect(() =>
    withSpanSync("test.span", {}, () => {
      calls++
      throw failure
    }),
  ).toThrow(failure)

  expect(calls).toBe(1)
})

test("withSpanSync returns fn's result when fn succeeds", () => {
  process.env.AX_CODE_OTLP_ENDPOINT = "https://1.1.1.1/v1/traces"

  let calls = 0
  const result = withSpanSync("test.span", {}, () => {
    calls++
    return "ok"
  })

  expect(result).toBe("ok")
  expect(calls).toBe(1)
})

test("withSpanSync runs fn once with a noop span when telemetry is disabled", () => {
  delete process.env.AX_CODE_OTLP_ENDPOINT

  let calls = 0
  const result = withSpanSync("test.span", {}, (span) => {
    calls++
    span.setAttribute("k", "v")
    return "ok"
  })

  expect(result).toBe("ok")
  expect(calls).toBe(1)
})
