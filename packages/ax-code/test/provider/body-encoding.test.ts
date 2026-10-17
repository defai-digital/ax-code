// ADR-247: per-provider compatibility.body_encoding.
//
// The wrapping logic is exported as `Provider.applyBodyEncoding` so the
// test exercises the same path the real fetch wrapper uses (no parallel
// implementation, no shadowing). The test only inspects the in/out
// contract; it does not shell out or touch the network.

import { test, expect, describe } from "vitest"
import { gunzipSync } from "node:zlib"
import { Provider } from "../../src/provider/provider"

describe("Provider.applyBodyEncoding (ADR-247 body_encoding)", () => {
  test("gzip wraps a string body and adds content-encoding", () => {
    const init: { body?: unknown; headers?: unknown } = {
      body: JSON.stringify({ model: "claude", messages: [{ role: "user", content: "hi" }] }),
      headers: { "content-type": "application/json" },
    }
    const mutated = Provider.applyBodyEncoding({ compatibility: { body_encoding: "gzip" } }, init)
    expect(mutated).toBe(true)
    expect(Buffer.isBuffer(init.body)).toBe(true)
    const round = JSON.parse(gunzipSync(init.body as Buffer).toString("utf8"))
    expect(round.model).toBe("claude")
    expect(round.messages[0].content).toBe("hi")
    const headers = init.headers as Record<string, string>
    expect(headers["content-type"]).toBe("application/json")
    expect(headers["content-encoding"]).toBe("gzip")
  })

  test("default (unset) is a no-op — preserves the string body and headers", () => {
    const init: { body?: unknown; headers?: unknown } = {
      body: '{"a":1}',
      headers: { "content-type": "application/json" },
    }
    const mutated = Provider.applyBodyEncoding({}, init)
    expect(mutated).toBe(false)
    expect(init.body).toBe('{"a":1}')
    expect((init.headers as Record<string, string>)["content-encoding"]).toBeUndefined()
  })

  test("body_encoding: 'json' is explicit and a no-op", () => {
    const init: { body?: unknown; headers?: unknown } = {
      body: '{"a":1}',
      headers: { "content-type": "application/json" },
    }
    const mutated = Provider.applyBodyEncoding({ compatibility: { body_encoding: "json" } }, init)
    expect(mutated).toBe(false)
    expect(init.body).toBe('{"a":1}')
  })

  test("non-string bodies are left alone (Buffer / Request / undefined)", () => {
    const buf = Buffer.from("not a string")
    const init: { body?: unknown; headers?: unknown } = { body: buf, headers: {} }
    const mutated = Provider.applyBodyEncoding({ compatibility: { body_encoding: "gzip" } }, init)
    expect(mutated).toBe(false)
    expect(init.body).toBe(buf)
    expect((init.headers as Record<string, string>)["content-encoding"]).toBeUndefined()
  })

  test("gzip preserves pre-existing headers and only adds content-encoding", () => {
    const init: { body?: unknown; headers?: unknown } = {
      body: "hello world",
      headers: {
        "x-ax-trace": "abc",
        "content-type": "text/plain",
      },
    }
    Provider.applyBodyEncoding({ compatibility: { body_encoding: "gzip" } }, init)
    const headers = init.headers as Record<string, string>
    expect(headers["x-ax-trace"]).toBe("abc")
    expect(headers["content-type"]).toBe("text/plain")
    expect(headers["content-encoding"]).toBe("gzip")
  })

  test("invalid body_encoding value is a no-op (config layer would reject, but defence in depth)", () => {
    const init: { body?: unknown; headers?: unknown } = {
      body: '{"a":1}',
      headers: {},
    }
    // Bypass zod with a stray string from a programmatic caller.
    const mutated = Provider.applyBodyEncoding(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { compatibility: { body_encoding: "brotli" } } as any,
      init,
    )
    expect(mutated).toBe(false)
    expect(init.body).toBe('{"a":1}')
  })
})
