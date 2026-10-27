import { afterEach, expect, test, vi } from "vitest"
import { defaultAskPermission } from "../../src/mcp/sampling"
import { Config } from "../../src/config/config"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { tmpdir } from "../fixture/fixture"
import fs from "node:fs/promises"
import path from "node:path"

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})

test.each(["managed", "project", "session", "agent", "autonomous"])(
  "%s denial wins over an existing sampling Always grant",
  async (layer) => {
    vi.stubEnv("AX_CODE_AUTONOMOUS", "false")
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    await using tmp = await tmpdir({ git: true })
    await using managed = await tmpdir()
    const previous = Config.managedConfigDir()
    Config.__setTestManagedConfigDir(managed.path)
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const request = { sessionID: session.id, server: "server", messageCount: 1, requestedMaxTokens: 10 }
          const asked = vi.fn()
          const off = Bus.subscribe(Permission.Event.Asked, ({ properties }) => {
            asked()
            void Permission.reply({ requestID: properties.id, reply: "always" })
          })
          expect(await defaultAskPermission(request)).toBe("allow")
          expect(asked).toHaveBeenCalledOnce()
          off()
          if (layer === "autonomous") vi.stubEnv("AX_CODE_AUTONOMOUS", "true")
          else if (layer === "session")
            await Session.setPermission({
              sessionID: session.id,
              permission: [{ permission: "mcp_sampling", pattern: "server", action: "deny" }],
            })
          else if (layer === "managed") {
            await fs.writeFile(
              path.join(managed.path, "ax-code.json"),
              JSON.stringify({ permission: { mcp_sampling: "deny" } }),
            )
            await fs.writeFile(
              path.join(managed.path, "ax-code.jsonc"),
              JSON.stringify({ permission: { mcp_sampling: "allow" } }),
            )
            await Config.invalidate()
          } else if (layer === "project") {
            await fs.writeFile(
              path.join(tmp.path, "ax-code.json"),
              JSON.stringify({ permission: { mcp_sampling: "deny" } }),
            )
            await Config.invalidate()
          }
          expect(
            await defaultAskPermission({
              ...request,
              ...(layer === "agent"
                ? {
                    ruleset: [{ permission: "mcp_sampling", pattern: "server", action: "deny" as const }],
                  }
                : {}),
            }),
          ).toBe("deny")
          expect(await Permission.list()).toEqual([])
        },
      })
    } finally {
      Config.__setTestManagedConfigDir(previous)
    }
  },
)

test("no sampling rule prompts, and an explicit configured allow can skip the prompt", async () => {
  vi.stubEnv("AX_CODE_AUTONOMOUS", "false")
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const request = { sessionID: session.id, server: "server", messageCount: 1, requestedMaxTokens: 10 }
      const asked = vi.fn()
      const off = Bus.subscribe(Permission.Event.Asked, ({ properties }) => {
        asked()
        void Permission.reply({ requestID: properties.id, reply: "reject" })
      })
      expect(await defaultAskPermission(request)).toBe("deny")
      expect(asked).toHaveBeenCalledOnce()
      off()
      await fs.writeFile(path.join(tmp.path, "ax-code.json"), JSON.stringify({ permission: { mcp_sampling: "allow" } }))
      await Config.invalidate()
      expect(await defaultAskPermission(request)).toBe("allow")
    },
  })
})

test("denies sampling for an agent that no longer exists", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      expect(
        await defaultAskPermission({
          sessionID: session.id,
          agent: "removed-agent",
          server: "srv",
          messageCount: 1,
          requestedMaxTokens: 100,
        }),
      ).toBe("deny")
    },
  })
})
