import { describe, expect, test } from "vitest"
import { Config } from "../../src/config/config"
import { Flag } from "../../src/flag/flag"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"
import { tmpdir } from "../fixture/fixture"

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

describe("AX_CODE_PERMISSION merge", () => {
  test("env blanket deny beats an earlier trusted curl allow by key order", async () => {
    // Flag.AX_CODE_PERMISSION is an import-time const, but the compiled
    // namespace member is a plain writable property and config-impl reads
    // it live at loadState time, so override it for this test and restore.
    // The earlier layer is inline (trusted) config: untrusted project
    // configs are deny-only-filtered and cannot carry ask/allow patterns.
    const flag = Flag as { AX_CODE_PERMISSION: string | undefined }
    const previous = flag.AX_CODE_PERMISSION
    flag.AX_CODE_PERMISSION = JSON.stringify({ bash: { "*": "deny" } })
    try {
      await using tmp = await tmpdir({ git: true })
      const originalInline = process.env["AX_CODE_CONFIG_CONTENT"]
      process.env["AX_CODE_CONFIG_CONTENT"] = JSON.stringify({
        username: "test",
        permission: { bash: { "*": "ask", "curl *": "allow" } },
      })
      try {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const config = await Config.get()
            const bash = config.permission?.bash
            // The env layer's patterns must be ordered last so they win.
            expect(typeof bash === "object" ? Object.keys(bash) : []).toEqual(["curl *", "*"])
            expect(
              Permission.evaluate("bash", "curl https://example.com", Permission.fromConfig(config.permission!)).action,
            ).toBe("deny")
          },
        })
      } finally {
        if (originalInline === undefined) delete process.env["AX_CODE_CONFIG_CONTENT"]
        else process.env["AX_CODE_CONFIG_CONTENT"] = originalInline
      }
    } finally {
      flag.AX_CODE_PERMISSION = previous
    }
  })

  test("an env pattern map keeps an earlier blanket deny as its floor", async () => {
    const flag = Flag as { AX_CODE_PERMISSION: string | undefined }
    const previous = flag.AX_CODE_PERMISSION
    flag.AX_CODE_PERMISSION = JSON.stringify({ bash: { "git status": "allow" } })
    try {
      await using tmp = await tmpdir({ git: true })
      const originalInline = process.env["AX_CODE_CONFIG_CONTENT"]
      process.env["AX_CODE_CONFIG_CONTENT"] = JSON.stringify({ username: "test", permission: { bash: "deny" } })
      try {
        await Instance.provide({
          directory: tmp.path,
          fn: async () => {
            const config = await Config.get()
            expect(config.permission?.bash).toEqual({ "*": "deny", "git status": "allow" })
            const rules = Permission.fromConfig(config.permission!)
            expect(Permission.evaluate("bash", "rm -rf build", rules).action).toBe("deny")
            expect(Permission.evaluate("bash", "git status", rules).action).toBe("allow")
          },
        })
      } finally {
        if (originalInline === undefined) delete process.env["AX_CODE_CONFIG_CONTENT"]
        else process.env["AX_CODE_CONFIG_CONTENT"] = originalInline
      }
    } finally {
      flag.AX_CODE_PERMISSION = previous
    }
  })
})
