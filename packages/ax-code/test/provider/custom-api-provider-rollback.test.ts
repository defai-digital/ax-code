import { afterEach, expect, test, vi } from "vitest"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { GlobalBus } from "../../src/bus/global"
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

function failRemoval(failure: Error, before?: () => Promise<void>) {
  const remove = vi.fn(async () => {
    await before?.()
    throw failure
  })
  vi.spyOn(Auth, "prepareRemoval").mockResolvedValueOnce(remove)
  return remove
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

test("a failed refresh after a custom API save restores both config and auth", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await CustomApiProvider.upsert(providerID, providerInput("previous-credential"))
      const previous = (await Config.getGlobal()).provider?.[providerID]
      const failure = new Error("Refresh listener failed")
      const listener = (event: { directory?: string }) => {
        if (event.directory !== "global") return
        GlobalBus.off("event", listener)
        throw failure
      }
      GlobalBus.on("event", listener)
      try {
        await expect(
          CustomApiProvider.upsert(providerID, { ...providerInput("new-credential"), name: "Replacement" }),
        ).rejects.toBe(failure)
        expect((await Config.getGlobal()).provider?.[providerID]).toEqual(previous)
        expect(await Auth.get(providerID)).toEqual({ type: "api", key: "previous-credential" })
      } finally {
        GlobalBus.off("event", listener)
      }
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
      failRemoval(failure, async () => {
        await Auth.set(providerID, { type: "api", key: "peer-credential" })
      })
      await expect(CustomApiProvider.remove(providerID)).rejects.toBe(failure)
      expect(await Auth.get(providerID)).toEqual({ type: "api", key: "peer-credential" })
      expect((await Config.getGlobal()).provider?.[providerID]).toEqual(previous)
    },
  })
})

test.each([
  ["before", "peer-credential"],
  ["before", "previous-credential"],
  ["after", "peer-credential"],
  ["after", "previous-credential"],
] as const)("custom API delete preserves a reconnect %s config removal (%s)", async (timing, key) => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await CustomApiProvider.upsert(providerID, providerInput("previous-credential"))
      const removeConfig = Config.removeGlobalProviderWithRollback
      vi.spyOn(Config, "removeGlobalProviderWithRollback").mockImplementationOnce(async (...args) => {
        const reconnect = () => CustomApiProvider.upsert(providerID, { ...providerInput(key), name: "Peer reconnect" })
        if (timing === "before") await reconnect()
        const rollback = await removeConfig(...args)
        if (timing === "after") await reconnect()
        return rollback
      })
      expect(await CustomApiProvider.remove(providerID)).toBe(true)
      expect((await Config.getGlobal()).provider?.[providerID]?.name).toBe("Peer reconnect")
      expect(await Auth.get(providerID)).toEqual({ type: "api", key })
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
      failRemoval(failure)
      const removeConfig = Config.removeGlobalProviderWithRollback
      vi.spyOn(Config, "removeGlobalProviderWithRollback").mockImplementationOnce(async (...args) => {
        await removeConfig(...args)
        return async () => {
          throw rollbackFailure
        }
      })
      await expect(CustomApiProvider.remove(providerID)).rejects.toMatchObject({
        name: "AggregateError",
        errors: [failure, rollbackFailure],
      })
      expect(await Auth.get(providerID)).toEqual({ type: "api", key: "previous-credential" })
    },
  })
})

test("credential capture failure leaves custom API configuration unchanged", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await CustomApiProvider.upsert(providerID, providerInput("previous-credential"))
      const previous = (await Config.getGlobal()).provider?.[providerID]
      const failure = new Error("Auth snapshot failed")
      vi.spyOn(Auth, "prepareRemoval").mockRejectedValueOnce(failure)
      await expect(CustomApiProvider.remove(providerID)).rejects.toBe(failure)
      expect((await Config.getGlobal()).provider?.[providerID]).toEqual(previous)
      expect(await Auth.get(providerID)).toEqual({ type: "api", key: "previous-credential" })
    },
  })
})

test("overlapping custom API disconnects do not restore removed configuration", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await CustomApiProvider.upsert(providerID, providerInput("previous-credential"))
      const removeConfig = Config.removeGlobalProviderWithRollback
      vi.spyOn(Config, "removeGlobalProviderWithRollback").mockImplementationOnce(async (...args) => {
        const rollback = await removeConfig(...args)
        await Auth.remove(providerID)
        return rollback
      })
      expect(await CustomApiProvider.remove(providerID)).toBe(true)
      expect((await Config.getGlobal()).provider?.[providerID]).toBeUndefined()
      expect(await Auth.get(providerID)).toBeUndefined()
    },
  })
})

test("a failed config restore after a peer reconnect preserves its credential and surfaces the failure once", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await CustomApiProvider.upsert(providerID, providerInput("previous-credential"))
      const prepare = Auth.prepareRemoval
      vi.spyOn(Auth, "prepareRemoval").mockImplementationOnce(async (...args) => {
        const remove = await prepare(...args)
        return async () => {
          await Auth.set(providerID, { type: "api", key: "peer-credential" })
          return remove()
        }
      })
      const failure = new Error("Config restore failed")
      const restore = vi.fn<() => Promise<boolean>>().mockRejectedValueOnce(failure)
      const removeConfig = Config.removeGlobalProviderWithRollback
      vi.spyOn(Config, "removeGlobalProviderWithRollback").mockImplementationOnce(async (...args) => {
        await removeConfig(...args)
        return restore
      })
      await expect(CustomApiProvider.remove(providerID)).rejects.toBe(failure)
      expect(restore).toHaveBeenCalledOnce()
      expect(await Auth.get(providerID)).toEqual({ type: "api", key: "peer-credential" })
    },
  })
})

test("a failed custom API delete preserves a peer's newer provider config", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await CustomApiProvider.upsert(providerID, providerInput("previous-credential"))
      const original = (await Config.getGlobal()).provider?.[providerID]
      if (!original) throw new Error("Missing provider fixture")
      const peer = { ...original, name: "Peer configuration" }
      const failure = new Error("Auth removal failed")
      failRemoval(failure, async () => {
        await Config.setGlobalProvider(providerID, peer)
      })
      await expect(CustomApiProvider.remove(providerID)).rejects.toBe(failure)
      expect((await Config.getGlobal()).provider?.[providerID]).toEqual(peer)
      expect(await Auth.get(providerID)).toEqual({ type: "api", key: "previous-credential" })
    },
  })
})

test.each(["managed", "unmanaged"] as const)(
  "delete rechecks a peer's %s provider under the config lock",
  async (kind) => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await CustomApiProvider.upsert(providerID, providerInput("previous-credential"))
        const getGlobal = Config.getGlobal
        const failure = new Error("Auth removal failed")
        let peer: Config.Provider | undefined
        vi.spyOn(Config, "getGlobal").mockImplementationOnce(async () => {
          const original = await getGlobal()
          const provider = original.provider?.[providerID]
          if (!provider) throw new Error("Missing provider fixture")
          peer = { ...provider, name: "Newer before delete", management: kind === "managed" ? "custom-api" : undefined }
          await Config.setGlobalProvider(providerID, peer)
          return original
        })
        const removeAuth = failRemoval(failure)
        if (kind === "unmanaged") {
          expect(await CustomApiProvider.remove(providerID)).toBe(false)
          expect(removeAuth).not.toHaveBeenCalled()
        } else {
          await expect(CustomApiProvider.remove(providerID)).rejects.toBe(failure)
          expect(removeAuth).toHaveBeenCalledOnce()
        }
        expect((await Config.getGlobal()).provider?.[providerID]).toEqual(peer)
      },
    })
  },
)

test("provider config rollback refreshes runtime state only once", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await CustomApiProvider.upsert(providerID, providerInput("previous-credential"))
      const rollback = await Config.removeGlobalProviderWithRollback(providerID)
      if (!rollback) throw new Error("Missing provider rollback")
      const dispose = vi.spyOn(Instance, "disposeAll")
      expect(await rollback()).toBe(true)
      expect(dispose).toHaveBeenCalledOnce()
      expect(await rollback()).toBe(true)
      expect(dispose).toHaveBeenCalledOnce()
    },
  })
})

test("failed initial config refresh restores the document before losing its rollback", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await CustomApiProvider.upsert(providerID, providerInput("previous-credential"))
      const original = (await Config.getGlobal()).provider?.[providerID]
      const failure = new Error("Runtime refresh failed")
      const emit = GlobalBus.emit.bind(GlobalBus)
      let pending = true
      vi.spyOn(GlobalBus, "emit").mockImplementation((name, event, payload) => {
        if (pending && event.directory === "global") {
          pending = false
          throw failure
        }
        return emit(name, event, payload)
      })
      await expect(Config.removeGlobalProviderWithRollback(providerID)).rejects.toBe(failure)
      expect((await Config.getGlobal()).provider?.[providerID]).toEqual(original)
    },
  })
})

test("removing an inherited property name does not edit global config", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await CustomApiProvider.upsert(providerID, providerInput("previous-credential"))
      const original = await Config.getGlobal()
      expect(await Config.removeGlobalProvider("toString")).toBe(false)
      expect(await Config.removeGlobalProviderWithRollback("toString")).toBeUndefined()
      expect(await Config.getGlobal()).toEqual(original)
    },
  })
})
