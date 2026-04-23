import { describe, expect, test } from "bun:test"
import {
  isOptionalStateUnavailableError,
  optionalStateErrorMessage,
  shouldSurfaceOptionalStateError,
} from "../../../src/cli/cmd/tui/util/optional-state"

describe("tui optional state errors", () => {
  test("suppresses read-only and missing-file state errors from user-facing toasts", () => {
    expect(isOptionalStateUnavailableError({ code: "ENOENT" })).toBeTrue()
    expect(isOptionalStateUnavailableError({ code: "EACCES" })).toBeTrue()
    expect(isOptionalStateUnavailableError({ code: "EPERM" })).toBeTrue()
    expect(isOptionalStateUnavailableError({ code: "EROFS" })).toBeTrue()
    expect(shouldSurfaceOptionalStateError({ code: "EPERM" })).toBeFalse()
  })

  test("still surfaces unexpected state errors", () => {
    expect(isOptionalStateUnavailableError(new Error("boom"))).toBeFalse()
    expect(shouldSurfaceOptionalStateError(new Error("boom"))).toBeTrue()
  })

  test("formats fallback messages for non-error values", () => {
    expect(optionalStateErrorMessage(new Error("disk full"), "fallback")).toBe("disk full")
    expect(optionalStateErrorMessage("weird", "fallback")).toBe("fallback")
  })
})
