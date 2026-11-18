import { afterEach, expect, test, vi } from "vitest"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { CustomApiProvider } from "../../src/provider/custom-api-provider"
import { tmpdir } from "../fixture/fixture"

const providerID = "rollback-custom-provider"

afterEach(async () => {
  vi.restoreAllMocks()
  await Auth.remove(providerID)
  await Config.removeGlobalProvider(providerID)
  await Instance.disposeAll()
})

function providerInput(apiKey?: string): CustomApiProvider.Upsert {
  return {
    name: "Rollback provider",
    protocol: "openai-compatible",
    baseURL: "https://example.invalid/v1",
    apiKey,
    allowInsecureHttp: false,
    models: [
      {
        id: "model",
        contextWindow: 128_000,
        outputLimit: 16_384,
        toolCall: true,
        reasoning: false,
        attachment: false,
        temperature: false,
      },
    ],
  }
}

test.each(["new", "previous", "peer", "same-peer", "metadata-only"] as const)(
  "failed custom API save preserves the correct credential (%s)",
  async (mode) => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        if (mode !== "new") await Auth.set(providerID, { type: "api", key: "previous-credential" })
        const failure = new Error("Config save failed")
        vi.spyOn(Config, "setGlobalProvider").mockImplementation(async () => {
          if (mode === "peer" || mode === "metadata-only")
            await Auth.set(providerID, { type: "api", key: "peer-credential" })
          if (mode === "same-peer") await Auth.set(providerID, { type: "api", key: "attempted-credential" })
          throw failure
        })
        await expect(
          CustomApiProvider.upsert(
            providerID,
            providerInput(mode === "metadata-only" ? undefined : "attempted-credential"),
          ),
        ).rejects.toBe(failure)
        const expected =
          mode === "new"
            ? undefined
            : mode === "peer" || mode === "metadata-only"
              ? "peer-credential"
              : mode === "same-peer"
                ? "attempted-credential"
                : "previous-credential"
        expect(await Auth.get(providerID)).toEqual(expected ? { type: "api", key: expected } : undefined)
      },
    })
  },
)

test("custom API save surfaces rollback failure alongside the original failure", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const failure = new Error("Config save failed")
      const rollbackFailure = new Error("Credential restore failed")
      vi.spyOn(Config, "setGlobalProvider").mockRejectedValueOnce(failure)
      const setKey = Auth.setApiKeyWithRollback
      vi.spyOn(Auth, "setApiKeyWithRollback").mockImplementationOnce(async (...args) => {
        await setKey(...args)
        return async () => {
          throw rollbackFailure
        }
      })
      await expect(CustomApiProvider.upsert(providerID, providerInput("attempted-credential"))).rejects.toMatchObject({
        name: "AggregateError",
        errors: [failure, rollbackFailure],
      })
    },
  })
})

test("a failed custom API delete does not rewrite a peer credential", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await CustomApiProvider.upsert(providerID, providerInput("previous-credential"))
      const previous = (await Config.getGlobal()).provider?.[providerID]
      const failure = new Error("Auth remove failed")
      vi.spyOn(Auth, "remove").mockImplementationOnce(async () => {
        await Auth.set(providerID, { type: "api", key: "peer-credential" })
        throw failure
      })
      await expect(CustomApiProvider.remove(providerID)).rejects.toBe(failure)
      expect(await Auth.get(providerID)).toEqual({ type: "api", key: "peer-credential" })
      expect((await Config.getGlobal()).provider?.[providerID]).toEqual(previous)
    },
  })
})

test("a failed custom API delete surfaces failed config restoration", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await CustomApiProvider.upsert(providerID, providerInput("previous-credential"))
      const failure = new Error("Auth remove failed")
      const rollbackFailure = new Error("Config restore failed")
      vi.spyOn(Auth, "remove").mockRejectedValueOnce(failure)
      vi.spyOn(Config, "setGlobalProvider").mockRejectedValueOnce(rollbackFailure)
      await expect(CustomApiProvider.remove(providerID)).rejects.toMatchObject({
        name: "AggregateError",
        errors: [failure, rollbackFailure],
      })
      expect(await Auth.get(providerID)).toEqual({ type: "api", key: "previous-credential" })
    },
  })
})
