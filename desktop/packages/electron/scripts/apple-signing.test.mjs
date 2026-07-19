import { describe, expect, test } from "vitest"
import {
  DEFAULT_APPLE_KEYCHAIN_PROFILE,
  DEFAULT_APPLE_TEAM_ID,
  isMacPackaging,
  resolveAppleSigningEnv,
} from "./apple-signing.mjs"

describe("local Apple signing configuration", () => {
  test("recognizes macOS packaging arguments", () => {
    expect(isMacPackaging(["--mac", "--arm64"])).toBe(true)
    expect(isMacPackaging(["--mac=dir"])).toBe(true)
    expect(isMacPackaging(["--win", "--x64"])).toBe(false)
  })

  test("uses the AX Code Keychain profile for local macOS packages", () => {
    const resolved = resolveAppleSigningEnv(["--mac", "--arm64"], {}, "darwin")
    expect(resolved.APPLE_KEYCHAIN_PROFILE).toBe(DEFAULT_APPLE_KEYCHAIN_PROFILE)
    expect(resolved.APPLE_TEAM_ID).toBe(DEFAULT_APPLE_TEAM_ID)
  })

  test("preserves explicit credentials and does not alter CI or other platforms", () => {
    expect(
      resolveAppleSigningEnv(
        ["--mac"],
        { APPLE_KEYCHAIN_PROFILE: "custom-profile", APPLE_TEAM_ID: "CUSTOM" },
        "darwin",
      ),
    ).toMatchObject({ APPLE_KEYCHAIN_PROFILE: "custom-profile", APPLE_TEAM_ID: "CUSTOM" })
    expect(resolveAppleSigningEnv(["--mac"], { CI: "true", APPLE_API_KEY: "/tmp/key.p8" }, "darwin")).toEqual({
      CI: "true",
      APPLE_API_KEY: "/tmp/key.p8",
    })
    expect(resolveAppleSigningEnv(["--win"], {}, "darwin")).toEqual({})
    expect(resolveAppleSigningEnv(["--mac"], {}, "linux")).toEqual({})
  })

  test("allows an explicit empty profile to keep local packages unnotarized", () => {
    const resolved = resolveAppleSigningEnv(["--mac"], { APPLE_KEYCHAIN_PROFILE: "" }, "darwin")
    expect(resolved.APPLE_KEYCHAIN_PROFILE).toBe("")
  })
})
