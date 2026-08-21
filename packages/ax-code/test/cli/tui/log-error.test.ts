import { describe, expect, test } from "vitest"
import { formatTuiLogError, formatWorkerLoadError } from "../../../src/cli/cmd/tui/util/log-error"

describe("tui log error formatting", () => {
  test("includes the stack for Error inputs", () => {
    const formatted = formatTuiLogError(new Error("route failed"))
    expect(formatted).toContain("Error: route failed")
    expect(formatted).toContain("\n    at ")
  })

  test("falls back to name and message when an Error has no stack", () => {
    const error = new Error("route failed")
    error.stack = undefined
    expect(formatTuiLogError(error)).toBe("Error: route failed")
  })

  test("appends recursively formatted cause info", () => {
    const error = new Error("route failed", { cause: new Error("connection refused") })
    const formatted = formatTuiLogError(error)
    expect(formatted).toContain("Error: route failed")
    expect(formatted).toContain("Caused by: Error: connection refused")
  })

  test("appends non-Error cause info", () => {
    const error = new Error("route failed", { cause: "plain failure" })
    expect(formatTuiLogError(error)).toContain("Caused by: plain failure")
  })

  test("preserves normal String(error) formatting for non-Error inputs", () => {
    expect(formatTuiLogError("plain failure")).toBe("plain failure")
  })

  test("falls back when error string conversion throws", () => {
    const broken = function brokenThrowable() {
      return undefined
    }
    Object.defineProperty(broken, Symbol.toPrimitive, {
      value() {
        throw new Error("cannot stringify")
      },
    })

    expect(formatTuiLogError(broken)).toBe("Unknown TUI error")
  })

  test("formats worker load errors with safe fallback messages", () => {
    const broken = function brokenThrowable() {
      return undefined
    }
    Object.defineProperty(broken, Symbol.toPrimitive, {
      value() {
        throw new Error("cannot stringify")
      },
    })

    expect(formatWorkerLoadError("/tmp/worker.js", broken)).toBe(
      "Worker failed to load (/tmp/worker.js): Unknown TUI error",
    )
  })
})
