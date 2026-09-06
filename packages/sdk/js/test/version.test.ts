import { describe, expect, test } from "vitest"
import { SDK_VERSION, isSDKVersionCompatible } from "../src/version"
import packageJson from "../package.json"

// Derive range fixtures from the current version so this suite keeps passing
// across version bumps.
const [major, minor, patch] = SDK_VERSION.split(".").map(Number)
const current = SDK_VERSION
const nextPatch = `${major}.${minor}.${patch + 1}`
const nextMinor = `${major}.${minor + 1}.0`
const nextMajor = `${major + 1}.0.0`
const prevMinor = `${major}.${Math.max(minor - 1, 0)}.0`

describe("SDK_VERSION", () => {
  test("is a semver string", () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test("matches the package.json version", () => {
    expect(SDK_VERSION).toBe(packageJson.version)
  })
})

describe("isSDKVersionCompatible", () => {
  test("exact match", () => {
    expect(isSDKVersionCompatible(current)).toBe(true)
    expect(isSDKVersionCompatible(prevMinor)).toBe(false)
    expect(isSDKVersionCompatible(nextPatch)).toBe(false)
    expect(isSDKVersionCompatible(nextMinor)).toBe(false)
    expect(isSDKVersionCompatible(nextMajor)).toBe(false)
  })

  test("caret range", () => {
    expect(isSDKVersionCompatible(`^${major}.0.0`)).toBe(true)
    expect(isSDKVersionCompatible(`^${prevMinor}`)).toBe(true)
    expect(isSDKVersionCompatible(current.replace(/^\d+\./, "1."))).toBe(false)
    expect(isSDKVersionCompatible(`^${nextMinor}`)).toBe(false)
    expect(isSDKVersionCompatible(`^${nextMajor}`)).toBe(false)
  })

  test("tilde range", () => {
    expect(isSDKVersionCompatible(`~${major}.${minor}.0`)).toBe(true)
    expect(isSDKVersionCompatible(`~${nextMinor}`)).toBe(false)
  })

  test("invalid range returns false", () => {
    expect(isSDKVersionCompatible("garbage")).toBe(false)
    expect(isSDKVersionCompatible("")).toBe(false)
  })
})
