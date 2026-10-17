import { afterEach, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})

test.each([false, true])("project sampling cannot enable or raise the user's cap (trusted=%s)", async (trusted) => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", trusted ? "1" : "0")
  vi.spyOn(Config, "global").mockResolvedValue({ mcp_sampling: { enabled: false, max_tokens: 100 } })
  await using tmp = await tmpdir({ git: true, config: { mcp_sampling: { enabled: true, max_tokens: 1000000 } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await Config.get()).mcp_sampling).toEqual({ enabled: false, max_tokens: 100 })
    },
  })
})

test.each([false, true])("only trusted project sampling may lower the user budget (trusted=%s)", async (trusted) => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", trusted ? "1" : "0")
  vi.spyOn(Config, "global").mockResolvedValue({ mcp_sampling: { enabled: true, max_tokens: 500 } })
  await using tmp = await tmpdir({ git: true, config: { mcp_sampling: { enabled: false, max_tokens: 100 } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await Config.get()).mcp_sampling).toEqual(
        trusted ? { enabled: false, max_tokens: 100 } : { enabled: true, max_tokens: 500 },
      )
    },
  })
})

test("managed sampling ceilings survive later managed files and trusted project config", async () => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  vi.spyOn(Config, "global").mockResolvedValue({ mcp_sampling: { enabled: true, max_tokens: 500 } })
  await using managed = await tmpdir()
  await using project = await tmpdir({ git: true, config: { mcp_sampling: { enabled: true, max_tokens: 1000000 } } })
  const previous = Config.managedConfigDir()
  Config.__setTestManagedConfigDir(managed.path)
  try {
    await fs.writeFile(
      path.join(managed.path, "ax-code.json"),
      JSON.stringify({ mcp_sampling: { enabled: false, max_tokens: 50 } }),
    )
    await fs.writeFile(
      path.join(managed.path, "ax-code.jsonc"),
      JSON.stringify({ mcp_sampling: { enabled: true, max_tokens: 1000000 } }),
    )
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect((await Config.get()).mcp_sampling).toEqual({ enabled: false, max_tokens: 50 })
      },
    })
  } finally {
    Config.__setTestManagedConfigDir(previous)
  }
})

test("an untrusted project cannot grant plugin session administration", async () => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "0")
  vi.spyOn(Config, "global").mockResolvedValue({})
  await using tmp = await tmpdir({
    git: true,
    config: { plugin_trust: { session_admin: ["file:///installed/plugin.js"] } },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await Config.get()).plugin_trust?.session_admin ?? []).toEqual([])
    },
  })
})

test("a user-level plugin session admin grant is kept", async () => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "0")
  vi.spyOn(Config, "global").mockResolvedValue({ plugin_trust: { session_admin: ["file:///installed/plugin.js"] } })
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await Config.get()).plugin_trust?.session_admin).toEqual(["file:///installed/plugin.js"])
    },
  })
})
