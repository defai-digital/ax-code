import { afterEach, expect, test, vi } from "vitest"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { disconnectProviderAuth } from "../../src/provider/disconnect"
import { disconnectPrivateGpu } from "../../src/provider/private-gpu"
import { tmpdir } from "../fixture/fixture"

const kinds = ["builtin", "custom", "dedicated", "private-wrapper"] as const
type Kind = (typeof kinds)[number]

function providerID(kind: Kind): string {
  return kind === "dedicated" || kind === "private-wrapper" ? "custom-private-gpu" : "disconnect-test-provider"
}

function provider(kind: Kind, name: string): Config.Provider {
  return {
    name,
    npm: "@ai-sdk/openai-compatible",
    ...(kind === "custom" ? { management: "custom-api" as const } : {}),
    options: { baseURL: "https://example.invalid/v1" },
  }
}

function disconnect(kind: Kind): (id: string) => Promise<void> {
  return kind === "private-wrapper" ? disconnectPrivateGpu : disconnectProviderAuth
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const id of new Set(kinds.map(providerID))) {
    await Auth.remove(id)
    await Config.removeGlobalProvider(id)
  }
  await Instance.disposeAll()
})

test.each(kinds)("normal %s disconnect removes only editor-owned metadata", async (kind) => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const id = providerID(kind)
      await Auth.set(id, { type: "api", key: "old-value" })
      await Config.setGlobalProvider(id, provider(kind, "Original"))
      await disconnect(kind)(id)
      expect(await Auth.get(id)).toBeUndefined()
      expect((await Config.getGlobal()).provider?.[id]?.name).toBe(kind === "builtin" ? "Original" : undefined)
    },
  })
})

test.each(
  kinds.flatMap((kind) =>
    ["before", "after"].flatMap((timing) => ["old-value", "new-value"].map((key) => ({ kind, timing, key }))),
  ),
)("$kind disconnect preserves a reconnect $timing config removal ($key)", async ({ kind, timing, key }) => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const id = providerID(kind)
      await Auth.set(id, { type: "api", key: "old-value" })
      await Config.setGlobalProvider(id, provider(kind, "Original"))
      const removeConfig = Config.removeGlobalProviderWithRollback
      vi.spyOn(Config, "removeGlobalProviderWithRollback").mockImplementationOnce(async (...args) => {
        const reconnect = async (): Promise<void> => {
          await Auth.set(id, { type: "api", key })
          await Config.setGlobalProvider(id, provider(kind, "Peer reconnect"))
        }
        if (timing === "before") await reconnect()
        const rollback = await removeConfig(...args)
        if (timing === "after") await reconnect()
        return rollback
      })
      await disconnect(kind)(id)
      expect(await Auth.get(id)).toEqual({ type: "api", key })
      expect((await Config.getGlobal()).provider?.[id]?.name).toBe("Peer reconnect")
    },
  })
})

test("auth-only disconnect removes a captured key even without provider metadata", async () => {
  await Auth.set("disconnect-test-provider", { type: "api", key: "old-value" })
  await disconnectProviderAuth("disconnect-test-provider")
  expect(await Auth.get("disconnect-test-provider")).toBeUndefined()
})
