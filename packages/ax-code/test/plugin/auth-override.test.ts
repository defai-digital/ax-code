import { afterEach, describe, expect, test, vi } from "vitest"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ProviderAuth } from "../../src/provider/auth"
import { ProviderID } from "../../src/provider/schema"

afterEach(() => vi.unstubAllEnvs())

describe("plugin.auth-override", () => {
  test("project plugin code is disabled until the workspace is explicitly trusted", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".ax-code", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })
        await fs.writeFile(
          path.join(pluginDir, "untrusted-auth.ts"),
          "export default async () => ({ auth: { provider: 'untrusted-test', methods: [{ type: 'api', label: 'Unsafe' }] } })\n",
        )
      },
    })

    const methods = await Instance.provide({
      directory: tmp.path,
      fn: async () => ProviderAuth.methods(),
    })

    expect(methods[ProviderID.make("untrusted-test")]).toBeUndefined()
  })

  test("user plugin overrides built-in github-copilot auth", async () => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".ax-code", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await fs.writeFile(
          path.join(pluginDir, "custom-copilot-auth.ts"),
          [
            "export default async () => ({",
            "  auth: {",
            '    provider: "github-copilot",',
            "    methods: [",
            '      { type: "api", label: "Test Override Auth" },',
            "    ],",
            "    loader: async () => ({ access: 'test-token' }),",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await using plain = await tmpdir()

    const methods = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        return ProviderAuth.methods()
      },
    })

    const plainMethods = await Instance.provide({
      directory: plain.path,
      fn: async () => {
        return ProviderAuth.methods()
      },
    })

    const copilot = methods[ProviderID.make("github-copilot")]
    expect(copilot).toBeDefined()
    expect(copilot.length).toBe(1)
    expect(copilot[0].label).toBe("Test Override Auth")
    expect(plainMethods[ProviderID.make("github-copilot")]?.[0]?.label).not.toBe("Test Override Auth")
  }, 60000) // Plugin installation may trigger bun install in CI
})

const file = path.join(import.meta.dirname, "../../src/plugin/index.ts")

describe("plugin.config-hook-error-isolation", () => {
  test("config hooks are individually error-isolated in the layer factory", async () => {
    const src = await fs.readFile(file, "utf-8")

    // The config hook try/catch lives in the InstanceState factory (layer definition),
    // not in init() which now just delegates to the Effect service.
    expect(src).toContain("plugin config hook failed")

    expect(src).toContain("for (const hook of [...hooks])")
    expect(src).toContain("const config = (hook as any).config")
    expect(src).toContain("Promise.resolve(config(cfg))")
    expect(src).toContain("plugin config hook timed out")
  })
})
