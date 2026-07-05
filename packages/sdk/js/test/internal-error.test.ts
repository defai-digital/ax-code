import { describe, expect, test } from "vitest"
import { errorMessage } from "../src/internal/error.js"

describe("internal error helpers", () => {
  test("formats Error instances and non-Error values", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom")
    expect(errorMessage("plain")).toBe("plain")
    expect(errorMessage(42)).toBe("42")
  })
})
