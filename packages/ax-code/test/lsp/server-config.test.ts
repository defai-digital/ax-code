import { describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { LSPServerConfig } from "../../src/lsp/server-config"
import { Instance } from "../../src/project/instance"
import { Process } from "../../src/util/process"
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

    expect(servers["sql-language-server"]?.extensions).toEqual([".sql"])
    expect(servers["ansible-language-server"]?.extensions).toEqual([".yaml", ".yml"])
    expect(servers["ansible-language-server"]?.languageId).toBe("ansible")
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
              languageId: "custom-language",
              initialization: { custom: true },
            },
          },
        })

        expect(servers.custom?.id).toBe("custom")
        expect(servers.custom?.semantic).toBe(true)
        expect(servers.custom?.priority).toBe(0)
        expect(servers.custom?.extensions).toEqual([".custom"])
        expect(servers.custom?.languageId).toBe("custom-language")
        expect(await servers.custom?.root("/tmp/file.custom")).toBe(tmp.path)
        expect(typeof servers.custom?.spawn).toBe("function")
      },
    })
  })

  test("empty custom command does not spawn an undefined executable", async () => {
    await using tmp = await tmpdir({ git: true })
    const spawnSpy = spyOn(Process, "spawn")

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const servers = LSPServerConfig.buildEnabledServers({
            lsp: {
              custom: {
                command: [],
                extensions: [".custom"],
              },
            },
          })

          expect(await servers.custom?.spawn?.(tmp.path)).toBeUndefined()
          expect(spawnSpy).not.toHaveBeenCalled()
        },
      })
    } finally {
      spawnSpy.mockRestore()
    }
  })

  test("ansible server only resolves roots with ansible project markers", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const servers = LSPServerConfig.buildEnabledServers({})
        const server = servers["ansible-language-server"]
        expect(server).toBeDefined()

        const playbook = path.join(tmp.path, "playbook.yml")
        expect(await server?.root(playbook)).toBeUndefined()

        await Bun.write(path.join(tmp.path, "ansible.cfg"), "[defaults]\n")
        expect(await server?.root(playbook)).toBe(tmp.path)
      },
    })
  })
})
