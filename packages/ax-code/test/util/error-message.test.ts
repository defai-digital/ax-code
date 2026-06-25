import { describe, expect, test } from "vitest"
import { toError, toErrorMessage, errorCode } from "@/util/error-message"

describe("toErrorMessage", () => {
  test("uses Error.message", () => {
    expect(toErrorMessage(new TypeError("invalid value"))).toBe("invalid value")
  })

  test("stringifies non-Error values", () => {
    expect(toErrorMessage("plain failure")).toBe("plain failure")
    expect(toErrorMessage(42)).toBe("42")
    expect(toErrorMessage(null)).toBe("null")
  })

  test("falls back when non-Error string conversion throws", () => {
    const broken = function brokenThrowable() {
      return undefined
    }
    Object.defineProperty(broken, Symbol.toPrimitive, {
      value() {
        throw new Error("cannot stringify")
      },
    })

    expect(toErrorMessage(broken)).toBe("Unknown error")
    expect(toError(broken)).toMatchObject({ message: "Unknown error" })
  })

  test("preserves Error values", () => {
    const error = new TypeError("invalid value")
    expect(toError(error)).toBe(error)
  })

  test("wraps non-Error values", () => {
    expect(toError("plain failure")).toMatchObject({ message: "plain failure" })
    expect(toError(null)).toMatchObject({ message: "null" })
  })
})

describe("errorCode", () => {
  test("extracts code from NodeJS.ErrnoException", () => {
    const err = Object.assign(new Error("not found"), { code: "ENOENT" })
    expect(errorCode(err)).toBe("ENOENT")
  })

  test("returns undefined for Error without code", () => {
    expect(errorCode(new Error("generic"))).toBeUndefined()
  })

  test("returns undefined for non-Error values", () => {
    expect(errorCode("string error")).toBeUndefined()
    expect(errorCode(null)).toBeUndefined()
    expect(errorCode(42)).toBeUndefined()
    expect(errorCode(undefined)).toBeUndefined()
  })

  test("handles various Node error codes", () => {
    expect(errorCode(Object.assign(new Error(), { code: "EACCES" }))).toBe("EACCES")
    expect(errorCode(Object.assign(new Error(), { code: "MODULE_NOT_FOUND" }))).toBe("MODULE_NOT_FOUND")
    expect(errorCode(Object.assign(new Error(), { code: "ECONNRESET" }))).toBe("ECONNRESET")
  })
})
