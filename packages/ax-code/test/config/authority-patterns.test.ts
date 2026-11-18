import path from "node:path"
import { expect, test, vi } from "vitest"
import { Config } from "../../src/config/config"
import { Flag } from "../../src/flag/flag"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

test.each(["managed", "environment"] as const)(
  "%s permission overrides retain earlier prototype-named denials",
  async (source) => {
    await using project = await tmpdir({ git: true })
    await using managed = await tmpdir()
    const previous = Config.managedConfigDir()
    const flags = Flag as { AX_CODE_PERMISSION: string | undefined }
    const previousPermission = flags.AX_CODE_PERMISSION
    Config.__setTestManagedConfigDir(managed.path)
    const permission = { read: { "*": "ask", constructor: "deny", toString: "deny", hasOwnProperty: "deny" } }
    const incoming = { read: { "README.md": "allow" } }
    vi.stubEnv("AX_CODE_CONFIG_CONTENT", JSON.stringify({ permission, agent: { build: { permission } } }))
    try {
      if (source === "managed") {
        await Filesystem.write(
          path.join(managed.path, "ax-code.json"),
          JSON.stringify({
            permission: incoming,
            agent: { build: { permission: incoming } },
          }),
        )
      } else {
        flags.AX_CODE_PERMISSION = JSON.stringify(incoming)
      }
      await Instance.provide({
        directory: project.path,
        fn: async () => {
          const config = await Config.get()
          for (const value of [config.permission, config.agent?.build?.permission]) {
            if (!value) throw new Error("Expected loaded permissions")
            const rules = Permission.fromConfig(value)
            for (const pattern of ["constructor", "toString", "hasOwnProperty"]) {
              expect(Permission.evaluate("read", pattern, rules).action).toBe("deny")
            }
          }
          expect(Permission.evaluate("read", "README.md", Permission.fromConfig(config.permission!)).action).toBe(
            "allow",
          )
        },
      })
    } finally {
      await Instance.disposeAll()
      Config.__setTestManagedConfigDir(previous)
      flags.AX_CODE_PERMISSION = previousPermission
      Config.global.reset()
      vi.unstubAllEnvs()
    }
  },
)
