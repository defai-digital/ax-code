import { expect, test, vi } from "vitest"
import { Provider } from "../../src/provider/provider"
import { CUSTOM_LOADERS, type CustomLoader } from "../../src/provider/loaders"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const id = ProviderID.make("registry-contract")

async function fixture(loader: CustomLoader, run: () => Promise<void>) {
  const previous = CUSTOM_LOADERS[id]
  CUSTOM_LOADERS[id] = loader
  try {
    await using tmp = await tmpdir({
      config: {
        provider: {
          [id]: {
            npm: "cli",
            env: [],
            models: { model: { name: "Model", tool_call: true, limit: { context: 8192, output: 1024 } } },
          },
        },
      },
    })
    await Instance.provide({ directory: tmp.path, fn: run })
  } finally {
    if (previous) CUSTOM_LOADERS[id] = previous
    else delete CUSTOM_LOADERS[id]
  }
}

test.each(["ready", "partial"] as const)("publishes stable snapshots when discovery becomes %s", async (phase) => {
  const discovered = Promise.withResolvers<Record<string, Provider.Model>>()
  await fixture(
    async () => ({ autoload: false, discoverModels: () => discovered.promise }),
    async () => {
      const initial = await Provider.snapshot()
      expect(initial.discovery.phase).toBe("pending")
      const model = await Provider.getModel(id, ModelID.make("model"))
      const providers = await Provider.list()
      providers[id].models.model.name = "mutated"
      model.api.id = "mutated"
      expect((await Provider.getModel(id, ModelID.make("model"))).api.id).toBe("model")
      expect((await Provider.list())[id].models.model.name).toBe("Model")
      expect(() => {
        ;(initial.providers[id].models.model.deployment as any).modelID = "mutated"
      }).toThrow()
      if (phase === "partial") discovered.reject(new Error("discovery failed"))
      else
        discovered.resolve({
          discovered: { ...model, id: ModelID.make("discovered"), api: { ...model.api, id: "discovered" } },
        })
      await Provider.ready()
      const final = await Provider.snapshot()
      expect(final.discovery.phase).toBe(phase)
      expect(final.revision).not.toBe(initial.revision)
      expect(initial.discovery.phase).toBe("pending")
      expect(initial.providers[id].models.discovered).toBeUndefined()
      if (phase === "ready") expect(final.providers[id].models.discovered).toBeDefined()
      else
        expect(final.discovery.diagnostics).toContainEqual({
          source: `discovery:${id}`,
          code: "provider-initialization-failed",
        })
    },
  )
})

test("one caller's cancellation cannot cancel another model preparation", async () => {
  const releases: Array<ReturnType<typeof Promise.withResolvers<object>>> = []
  await fixture(
    async () => ({
      autoload: false,
      getModel: async (_sdk, _modelID, _options, context) => {
        const gate = Promise.withResolvers<object>()
        releases.push(gate)
        context?.signal?.addEventListener("abort", () => gate.reject(context.signal!.reason), { once: true })
        return gate.promise
      },
    }),
    async () => {
      const model = await Provider.getModel(id, ModelID.make("model"))
      const firstSignal = new AbortController()
      const secondSignal = new AbortController()
      const first = Provider.getLanguage(model, { signal: firstSignal.signal }).catch((error) => error)
      const second = Provider.getLanguage(model, { signal: secondSignal.signal })
      await vi.waitFor(() => expect(releases).toHaveLength(2))
      firstSignal.abort()
      expect(await first).toMatchObject({ name: "AbortError" })
      releases[1].resolve({ model: "second" })
      expect(await second).toEqual({ model: "second" })
      await expect(Provider.getLanguage(model, { signal: firstSignal.signal })).rejects.toMatchObject({
        name: "AbortError",
      })
    },
  )
})

test("language cache evicts old entries while preserving recent entries", async () => {
  let calls = 0
  await fixture(
    async () => ({ autoload: false, getModel: async () => ({ sequence: ++calls }) }),
    async () => {
      const model = await Provider.getModel(id, ModelID.make("model"))
      const load = (slot: number) => Provider.getLanguage({ ...model, options: { slot } })
      const first = await load(0)
      let recent: unknown
      for (let slot = 1; slot <= 512; slot++) recent = await load(slot)
      expect(await load(512)).toBe(recent)
      expect(calls).toBe(513)
      expect(await load(0)).not.toBe(first)
      expect(calls).toBe(514)
    },
  )
})

test("cancellation settles promptly even when a custom loader ignores its signal", async () => {
  const gate = Promise.withResolvers<object>()
  let calls = 0
  await fixture(
    async () => ({ autoload: false, getModel: async () => (++calls === 1 ? gate.promise : { fresh: true }) }),
    async () => {
      const model = await Provider.getModel(id, ModelID.make("model"))
      const controller = new AbortController()
      let outcome: unknown
      const waiting = Provider.getLanguage(model, { signal: controller.signal }).catch((error) => {
        outcome = error
      })
      try {
        await vi.waitFor(() => expect(calls).toBe(1))
        controller.abort()
        await vi.waitFor(() => expect(outcome).toMatchObject({ name: "AbortError" }), { timeout: 250 })
      } finally {
        gate.resolve({ cancelled: true })
        await waiting
      }
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(await Provider.getLanguage(model)).toEqual({ fresh: true })
      expect(calls).toBe(2)
    },
  )
})
