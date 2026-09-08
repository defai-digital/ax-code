import { afterEach, describe, expect, test, vi } from "vitest"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ProviderAuth } from "../../src/provider/auth"
import { Auth } from "../../src/auth"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

async function withOauthPlugin(fn: () => Promise<void>) {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  await using tmp = await tmpdir({
    init: async (dir) => {
      const pluginDir = path.join(dir, ".ax-code", "plugin")
      await fs.mkdir(pluginDir, { recursive: true })
      await fs.writeFile(
        path.join(pluginDir, "oauth-flow.ts"),
        [
          "export default async () => ({",
          "  auth: {",
          "    provider: 'oauth-flow-test',",
          "    methods: [{",
          "      type: 'oauth',",
          "      label: 'Flow test',",
          "      authorize: async () => ({",
          "        url: 'https://auth.example/authorize',",
          "        method: 'code',",
          "        instructions: 'visit the url',",
          "        callback: async (code?: string) => ({ type: 'success', key: `flow-${code}` }),",
          "      }),",
          "    }],",
          "  },",
          "})",
          "",
        ].join("\n"),
      )
      await fs.writeFile(
        path.join(pluginDir, "oauth-shape.ts"),
        [
          "export default async () => ({",
          "  auth: {",
          "    provider: 'oauth-shape-test',",
          "    methods: [{",
          "      type: 'oauth',",
          "      label: 'Shape test',",
          "      authorize: async () => ({",
          "        url: 'https://auth.example/authorize',",
          "        method: 'code',",
          "        instructions: 'visit the url',",
          "        callback: async () => ({ type: 'success' }),",
          "      }),",
          "    }],",
          "  },",
          "})",
          "",
        ].join("\n"),
      )
    },
  })
  try {
    await Instance.provide({ directory: tmp.path, fn })
  } finally {
    await Auth.remove("oauth-flow-test").catch(() => undefined)
    await Auth.remove("oauth-shape-test").catch(() => undefined)
  }
}

describe("provider.auth pending oauth flows", () => {
  test("completes a fresh code flow and persists the api credential", async () => {
    await withOauthPlugin(async () => {
      await ProviderAuth.authorize({ providerID: "oauth-flow-test" as never, method: 0 })
      await ProviderAuth.callback({ providerID: "oauth-flow-test" as never, method: 0, code: "abc" })
      const stored = await Auth.get("oauth-flow-test")
      expect(stored).toMatchObject({ type: "api", key: "flow-abc" })
    })
  })

  test("rejects a callback for an expired pending flow", async () => {
    await withOauthPlugin(async () => {
      await ProviderAuth.authorize({ providerID: "oauth-flow-test" as never, method: 0 })
      const now = Date.now()
      vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60 * 1000)
      await expect(
        ProviderAuth.callback({ providerID: "oauth-flow-test" as never, method: 0, code: "abc" }),
      ).rejects.toMatchObject({ name: "ProviderAuthOauthMissing" })
      vi.restoreAllMocks()
      // The expired entry was evicted: a later callback also fails instead of
      // completing an abandoned exchange.
      await expect(
        ProviderAuth.callback({ providerID: "oauth-flow-test" as never, method: 0, code: "abc" }),
      ).rejects.toMatchObject({ name: "ProviderAuthOauthMissing" })
      await expect(Auth.get("oauth-flow-test")).resolves.toBeUndefined()
    })
  })

  test("a success result with no credential shape fails the callback instead of lying", async () => {
    await withOauthPlugin(async () => {
      await ProviderAuth.authorize({ providerID: "oauth-shape-test" as never, method: 0 })
      await expect(
        ProviderAuth.callback({ providerID: "oauth-shape-test" as never, method: 0, code: "abc" }),
      ).rejects.toMatchObject({ name: "ProviderAuthOauthCallbackFailed" })
      await expect(Auth.get("oauth-shape-test")).resolves.toBeUndefined()
    })
  })
})
