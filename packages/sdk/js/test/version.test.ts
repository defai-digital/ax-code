import { describe, expect, test } from "bun:test"
import { SDK_VERSION, isSDKVersionCompatible } from "../src/version"

describe("SDK_VERSION", () => {
  test("is a semver string", () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test("matches 2.0.0", () => {
    expect(SDK_VERSION).toBe("2.0.0")
  })
})

describe("isSDKVersionCompatible", () => {
  test("exact match", () => {
    expect(isSDKVersionCompatible("2.0.0")).toBe(true)
    expect(isSDKVersionCompatible("1.4.0")).toBe(false)
    expect(isSDKVersionCompatible("2.1.0")).toBe(false)
  })

  test("caret range", () => {
    expect(isSDKVersionCompatible("^2.0.0")).toBe(true)
    expect(isSDKVersionCompatible("^1.0.0")).toBe(false)
    expect(isSDKVersionCompatible("^2.0.1")).toBe(false)
    expect(isSDKVersionCompatible("^2.1.0")).toBe(false)
  })

  test("invalid range returns false", () => {
    expect(isSDKVersionCompatible("garbage")).toBe(false)
    expect(isSDKVersionCompatible("")).toBe(false)
  })
})
