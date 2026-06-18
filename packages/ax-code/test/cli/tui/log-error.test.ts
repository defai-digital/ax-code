import { describe, expect, test } from "bun:test"
import { formatTuiLogError, formatWorkerLoadError } from "../../../src/cli/cmd/tui/util/log-error"

describe("tui log error formatting", () => {
  test("preserves normal String(error) formatting", () => {
    expect(formatTuiLogError(new Error("route failed"))).toBe("Error: route failed")
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

    expect(formatWorkerLoadError("/tmp/worker.js", broken)).toBe("Worker failed to load (/tmp/worker.js): Unknown TUI error")
  })
})
