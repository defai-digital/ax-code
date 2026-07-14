import { describe, expect, test } from "vitest"
import { isHarmlessInterrupt } from "../../src/util/harmless-interrupt"

describe("isHarmlessInterrupt", () => {
  test("matches Effect fiber interrupt string", () => {
    expect(isHarmlessInterrupt(new Error("All fibers interrupted without error"))).toBe(true)
  })

  test("matches AbortError name", () => {
    const err = new DOMException("Aborted", "AbortError")
    expect(isHarmlessInterrupt(err)).toBe(true)
    const e2 = new Error("Aborted")
    e2.name = "AbortError"
    expect(isHarmlessInterrupt(e2)).toBe(true)
  })

  test("matches TimeoutError and CanceledError", () => {
    const t = new Error("timeout")
    t.name = "TimeoutError"
    expect(isHarmlessInterrupt(t)).toBe(true)
    const c = new Error("canceled")
    c.name = "CanceledError"
    expect(isHarmlessInterrupt(c)).toBe(true)
  })

  test("matches broken-pipe style codes", () => {
    const err = Object.assign(new Error("write EPIPE"), { code: "EPIPE" })
    expect(isHarmlessInterrupt(err)).toBe(true)
    expect(isHarmlessInterrupt(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true)
  })

  test("matches common abort message forms", () => {
    expect(isHarmlessInterrupt(new Error("This operation was aborted"))).toBe(true)
    expect(isHarmlessInterrupt(new Error("The operation was aborted"))).toBe(true)
    expect(isHarmlessInterrupt("aborted")).toBe(true)
  })

  test("does not match real application failures", () => {
    expect(isHarmlessInterrupt(new Error("Cannot find module foo"))).toBe(false)
    expect(isHarmlessInterrupt(new Error("permission denied"))).toBe(false)
    expect(isHarmlessInterrupt(null)).toBe(false)
    expect(isHarmlessInterrupt(undefined)).toBe(false)
  })

  test("matches nested abort cause", () => {
    const cause = new DOMException("Aborted", "AbortError")
    const outer = new Error("fetch failed", { cause })
    expect(isHarmlessInterrupt(outer)).toBe(true)
  })
})
