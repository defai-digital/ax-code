import { describe, expect, test } from "vitest"
import { ServerError } from "../src/errors"

describe("ServerError", () => {
  test("formats short bodies inline", () => {
    const err = new ServerError(500, "boom")
    expect(err.message).toBe("Server error 500: boom")
    expect(err.status).toBe(500)
    expect(err.bodyText).toBe("boom")
  })

  test("truncates bodies past 300 chars", () => {
    const long = "x".repeat(500)
    const err = new ServerError(502, long)
    expect(err.message.length).toBeLessThanOrEqual(300 + "Server error 502: ".length)
    expect(err.message.startsWith("Server error 502: ")).toBe(true)
  })

  test("falls back to '(no body)' for empty body", () => {
    const err = new ServerError(401, "")
    expect(err.message).toBe("Server error 401: (no body)")
  })

  test("is an instance of Error", () => {
    expect(new ServerError(500, "x")).toBeInstanceOf(Error)
  })
})
