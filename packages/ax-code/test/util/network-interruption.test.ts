import { describe, expect, test } from "vitest"
import { isNetworkInterruption, networkInterruptionCause } from "../../src/util/network-interruption"

const http2Reset = () =>
  Object.assign(new Error("Stream closed with error code NGHTTP2_INTERNAL_ERROR"), { code: "ERR_HTTP2_STREAM_ERROR" })

describe("network interruption", () => {
  test("matches undici's bare terminated and other-side-closed TypeErrors", () => {
    expect(isNetworkInterruption(new TypeError("terminated"))).toBe(true)
    expect(isNetworkInterruption(new TypeError("other side closed"))).toBe(true)
  })

  test("finds an HTTP/2 or socket code on a nested cause", () => {
    const reset = http2Reset()
    expect(networkInterruptionCause(new TypeError("terminated", { cause: reset }))).toBe(reset)
    const nested = new Error("wrapped", { cause: new Error("middle", { cause: reset }) })
    expect(networkInterruptionCause(nested)).toBe(reset)
    const socket = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" })
    expect(isNetworkInterruption(new TypeError("fetch interrupted", { cause: socket }))).toBe(true)
  })

  test("ignores lookalike messages and unrelated causes", () => {
    expect(isNetworkInterruption(new Error("terminated"))).toBe(false)
    expect(isNetworkInterruption(new TypeError("session terminated"))).toBe(false)
    expect(isNetworkInterruption("terminated")).toBe(false)
    expect(isNetworkInterruption(new Error("bad", { cause: Object.assign(new Error("x"), { code: "ENOENT" }) }))).toBe(
      false,
    )
  })

  test("stops at a bounded cause depth", () => {
    let error: Error = http2Reset()
    for (let i = 0; i < 6; i++) error = new Error(`layer ${i}`, { cause: error })
    expect(isNetworkInterruption(error)).toBe(false)
  })
})
