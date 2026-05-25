import { describe, expect, test } from "bun:test"
import { Config } from "../../src/config/config"

describe("AX_CODE_PERMISSION decoding", () => {
  test("decodes already-parsed permission config values", () => {
    expect(Config.decodePermissionEnvValue({ bash: "allow", edit: "ask" })).toEqual({
      ok: true,
      permission: {
        bash: "allow",
        edit: "ask",
      },
    })
  })

  test("parses valid permission config JSON", () => {
    expect(Config.parsePermissionEnv(JSON.stringify({ bash: "allow", edit: "ask" }))).toEqual({
      ok: true,
      permission: {
        bash: "allow",
        edit: "ask",
      },
    })
  })

  test("reports invalid JSON separately from schema mismatches", () => {
    expect(Config.parsePermissionEnv("{not json")).toEqual({
      ok: false,
      reason: "json",
    })

    const result = Config.parsePermissionEnv(JSON.stringify({ bash: "sometimes" }))
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({
      ok: false,
      reason: "schema",
    })
    if (!result.ok && result.reason === "schema") {
      expect(result.errors.length).toBeGreaterThan(0)
    }
  })
})
