import { describe, expect, test } from "vitest"
import {
  createHeadlessAgentRuntime,
  parseHeadlessRuntimeJsonBody,
  parseHeadlessRuntimeResponseBody,
} from "../../../src/runtime/headless"

describe("headless runtime", () => {
  test("parseHeadlessRuntimeResponseBody decodes JSON bodies", () => {
    expect(parseHeadlessRuntimeResponseBody(JSON.stringify({ ok: true }))).toEqual({ ok: true })
  })

  test("parseHeadlessRuntimeJsonBody decodes non-empty JSON bodies", () => {
    expect(parseHeadlessRuntimeJsonBody(JSON.stringify({ ok: true }))).toEqual({ ok: true })
  })

  test("parseHeadlessRuntimeResponseBody treats empty bodies as accepted", () => {
    expect(parseHeadlessRuntimeResponseBody("")).toBe(true)
  })

  test("parseHeadlessRuntimeResponseBody reports invalid JSON with a bounded preview", () => {
    expect(() => parseHeadlessRuntimeResponseBody("{not json")).toThrow("Headless runtime returned invalid JSON")
    expect(() => parseHeadlessRuntimeJsonBody("{not json")).toThrow("Headless runtime returned invalid JSON")
  })

  test("command posts include directory headers", async () => {
    let request: Request | undefined
    const headers = { Authorization: "Basic token" }
    const runtime = createHeadlessAgentRuntime({
      baseUrl: "http://localhost",
      directory: "/tmp/測試",
      headers,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        request = input instanceof Request ? input : new Request(input, init)
        return new Response("", { status: 202 })
      }) as typeof fetch,
    })

    await runtime.send({
      type: "session.abort",
      sessionID: "ses_123",
    })

    expect(request?.headers.get("x-ax-code-directory")).toBe("%2Ftmp%2F%E6%B8%AC%E8%A9%A6")
    expect(request?.headers.get("x-opencode-directory")).toBe("%2Ftmp%2F%E6%B8%AC%E8%A9%A6")
    expect(request?.headers.get("authorization")).toBe("Basic token")
    expect(headers).toEqual({ Authorization: "Basic token" })
  })
})
