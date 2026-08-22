import { describe, expect, test } from "vitest"
import { formatError, readRssKb, withDeadline } from "../src/spawn"

describe("withDeadline", () => {
  test("resolves with the wrapped value", async () => {
    await expect(withDeadline(Promise.resolve(42), 1_000, "test")).resolves.toBe(42)
  })

  test("rejects when the deadline wins", async () => {
    const never = new Promise(() => {})
    await expect(withDeadline(never, 25, "cold start (fake)")).rejects.toThrow("cold start (fake) timed out after 25ms")
  })

  test("propagates a rejection that beats the deadline", async () => {
    await expect(withDeadline(Promise.reject(new Error("boom")), 1_000, "test")).rejects.toThrow("boom")
  })
})

describe("formatError", () => {
  test("renders name and message for plain errors", () => {
    expect(formatError(new Error("plain failure"))).toBe("Error: plain failure")
  })

  test("unwraps cause chains instead of serializing them to {}", () => {
    const inner = new Error("stream closed")
    const outer = new Error("initialize failed", { cause: inner })
    const rendered = formatError(outer)
    expect(rendered).toContain("initialize failed")
    expect(rendered).toContain("caused by Error: stream closed")
  })

  test("renders non-Error values via inspect", () => {
    expect(formatError({ code: -32600 })).toContain("-32600")
  })
})

describe("readRssKb", () => {
  test("reads the current process RSS", async () => {
    const kb = await readRssKb(process.pid)
    expect(kb).toBeGreaterThan(0)
  })

  test("returns undefined for a dead pid", async () => {
    // PID 2^22 is beyond any plausible live process.
    await expect(readRssKb(4_194_304)).resolves.toBeUndefined()
  })
})
