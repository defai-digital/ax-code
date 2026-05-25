import { describe, expect, test } from "bun:test"
import { LSPServerConfig } from "../../src/lsp/server-config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("LSPServerConfig", () => {
  test("applies built-in profiles to server defaults", () => {
    const servers = LSPServerConfig.buildEnabledServers({})

    expect(servers.eslint?.semantic).toBe(false)
    expect(servers.eslint?.priority).toBeLessThan(0)
    expect(servers.eslint?.concurrency).toBe(1)
    expect(servers.eslint?.capabilityHints?.references).toBe(false)

    expect(servers.typescript?.semantic).toBe(true)
    expect(servers.typescript?.priority).toBeGreaterThan(0)
    expect(servers.typescript?.concurrency).toBeGreaterThan(0)
  })

  test("removes disabled servers from the enabled set", () => {
    const servers = LSPServerConfig.buildEnabledServers({
      lsp: {
        typescript: { disabled: true },
      },
    })

    expect(servers.typescript).toBeUndefined()
  })

  test("user config overrides built-in profile values and merges capability hints", () => {
    const servers = LSPServerConfig.buildEnabledServers({
      lsp: {
        eslint: {
          semantic: true,
          priority: 42,
          concurrency: 3,
          capabilities: {
            references: true,
            hover: false,
          },
        },
      },
    })

    expect(servers.eslint?.semantic).toBe(true)
    expect(servers.eslint?.priority).toBe(42)
    expect(servers.eslint?.concurrency).toBe(3)
    expect(servers.eslint?.capabilityHints?.references).toBe(true)
    expect(servers.eslint?.capabilityHints?.hover).toBe(false)
    expect(servers.eslint?.capabilityHints?.definition).toBe(false)
  })

  test("custom servers get default root, extension, and command spawn surface", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const servers = LSPServerConfig.buildEnabledServers({
          lsp: {
            custom: {
              command: ["custom-lsp", "--stdio"],
              extensions: [".custom"],
              initialization: { custom: true },
            },
          },
        })

        expect(servers.custom?.id).toBe("custom")
        expect(servers.custom?.semantic).toBe(true)
        expect(servers.custom?.priority).toBe(0)
        expect(servers.custom?.extensions).toEqual([".custom"])
        expect(await servers.custom?.root("/tmp/file.custom")).toBe(tmp.path)
        expect(typeof servers.custom?.spawn).toBe("function")
      },
    })
  })
})
