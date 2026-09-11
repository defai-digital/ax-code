import { afterEach, expect, test, vi } from "vitest"
import http from "node:http"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Auth } from "../../src/auth"
import { Bus } from "../../src/bus"
import { CustomApiProvider } from "../../src/provider/custom-api-provider"
import { modelDisplayInfo } from "../../src/cli/cmd/tui/component/model-vision-label"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function endpoint(handler: http.RequestListener) {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    async [Symbol.asyncDispose]() {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    },
  }
}

const vision = {
  id: "fixture-vision",
  name: "Updated Flash Vision",
  limit: { context: 1_000_000, output: 384_000 },
  capabilities: { attachment: true, reasoning: true, toolcall: true, temperature: true },
}

function config(providerID: string, baseURL: string, management?: "ax-trust" | "custom-api") {
  return {
    enabled_providers: [providerID],
    provider: {
      [providerID]: {
        management,
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL },
        models: {
          retired: { name: "Retired", limit: { context: 8000, output: 2000 } },
          [vision.id]: { name: "Old Name", attachment: false, limit: { context: 8000, output: 2000 } },
        },
      },
    },
  }
}

test.each([
  ["managed-gateway", "ax-trust"],
  ["ax-trust-legacy", undefined],
] as const)("%s refreshes metadata in the background and notifies the TUI", async (id, management) => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  let respond!: () => void
  const requested = new Promise<void>((resolve) => {
    respond = resolve
  })
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  await using api = await endpoint(async (req, res) => {
    calls++
    expect(req.url).toBe("/v1/models")
    expect(req.headers.authorization).toBe("Bearer startup-test-token")
    respond()
    await pending
    res.setHeader("Content-Type", "application/json")
    res.end(
      JSON.stringify({
        data: [
          vision,
          { ...vision, id: "deepseek-flash", name: "DeepSeek Flash" },
          { id: "text-only", capabilities: { attachment: false } },
        ],
      }),
    )
  })
  await using tmp = await tmpdir({ config: config(id, api.url, management) })
  const before = await fs.readFile(path.join(tmp.path, "ax-code.json"), "utf8")
  await Auth.set(id, { type: "api", key: "startup-test-token" })
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const updated = vi.fn()
        const unsubscribe = Bus.subscribe(Provider.Event.Updated, updated)
        try {
          const initial = await Provider.list()
          expect(initial[ProviderID.make(id)].models.retired).toBeDefined()
          await requested
          expect(updated).not.toHaveBeenCalled()
          release()
          await Provider.ready()
          const refreshed = (await Provider.list())[ProviderID.make(id)]
          expect(Object.keys(refreshed.models).sort()).toEqual([vision.id, "deepseek-flash", "text-only"].sort())
          const model = await Provider.getModel(ProviderID.make(id), ModelID.make(vision.id))
          expect(model.name).toBe(vision.name)
          expect(model.limit).toEqual(vision.limit)
          expect(model.capabilities).toMatchObject({ reasoning: true, toolcall: true, input: { image: true } })
          expect(modelDisplayInfo(model.id, model).label).toBe("Updated Flash Vision 👀")
          expect(modelDisplayInfo("deepseek-flash", refreshed.models["deepseek-flash"]).label).toBe("DeepSeek Flash 👀")
          expect(refreshed.models["text-only"].capabilities.input.image).toBe(false)
          expect(updated).toHaveBeenCalledOnce()
          expect(calls).toBe(1)
          expect(await Auth.get(id)).toEqual({ type: "api", key: "startup-test-token" })
          expect(await fs.readFile(path.join(tmp.path, "ax-code.json"), "utf8")).toBe(before)
        } finally {
          release()
          unsubscribe()
        }
      },
    })
  } finally {
    await Auth.remove(id)
  }
})

test.each([
  [401, "unauthorized"],
  [200, "invalid JSON"],
  [200, JSON.stringify({ data: [] })],
  [200, JSON.stringify({ data: [{ id: "bad\u0000id" }] })],
] as const)("preserves saved models when discovery returns %s / %s", async (status, body) => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  await using api = await endpoint((_req, res) => {
    res.statusCode = status
    res.end(body)
  })
  const id = "ax-trust-failure"
  await using tmp = await tmpdir({ config: config(id, api.url) })
  await Auth.set(id, { type: "api", key: "test-token" })
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        expect((await Provider.list())[ProviderID.make(id)].models.retired).toBeDefined()
      },
    })
  } finally {
    await Auth.remove(id)
  }
})

test.each(["disabled", "unconnected", "custom-api"])("does not discover a %s provider", async (mode) => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  const discover = vi.spyOn(CustomApiProvider, "discoverModels")
  const id = mode === "custom-api" ? "ordinary-gateway" : "ax-trust-skipped"
  const settings = config(id, "http://127.0.0.1:1/v1", mode === "custom-api" ? "custom-api" : "ax-trust")
  await using tmp = await tmpdir({
    config: { ...settings, ...(mode === "disabled" ? { disabled_providers: [id] } : {}) },
  })
  if (mode !== "unconnected") await Auth.set(id, { type: "api", key: "test-token" })
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
      },
    })
    expect(discover).not.toHaveBeenCalled()
  } finally {
    await Auth.remove(id)
  }
})

test("authoritative discovery does not truncate the model list at the editor limit", () => {
  const data = Array.from({ length: 150 }, (_, i) => ({ id: `model-${i}` }))
  expect(CustomApiProvider.parseDiscoveredModels({ data }, true)).toHaveLength(150)
  expect(CustomApiProvider.parseDiscoveredModels({ data })).toHaveLength(128)
  expect(() => CustomApiProvider.parseDiscoveredModels({ data: Array(4097).fill({ id: "model" }) }, true)).toThrow(
    "4096",
  )
})

test("refresh applies filters and loads an AX Trust provider with no saved models", async () => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  await using api = await endpoint((_req, res) => {
    res.end(JSON.stringify({ data: [vision, { id: "blocked" }] }))
  })
  const id = "ax-trust-empty"
  const settings = config(id, api.url)
  await using tmp = await tmpdir({
    config: {
      ...settings,
      provider: { [id]: { ...settings.provider[id], models: {}, whitelist: [vision.id] } },
    },
  })
  await Auth.set(id, { type: "api", key: "test-token" })
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = await Provider.getModel(ProviderID.make(id), ModelID.make(vision.id))
        expect(model.capabilities.input.image).toBe(true)
        expect(Object.keys((await Provider.list())[ProviderID.make(id)].models)).toEqual([vision.id])
      },
    })
  } finally {
    await Auth.remove(id)
  }
})

test("timeout retains saved metadata", async () => {
  vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
  vi.spyOn(CustomApiProvider, "discoverModels").mockRejectedValue(new DOMException("Timed out", "TimeoutError"))
  const id = "ax-trust-timeout"
  await using tmp = await tmpdir({ config: config(id, "http://127.0.0.1:1/v1") })
  await Auth.set(id, { type: "api", key: "test-token" })
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Provider.ready()
        expect((await Provider.getModel(ProviderID.make(id), ModelID.make(vision.id))).name).toBe("Old Name")
      },
    })
  } finally {
    await Auth.remove(id)
  }
})

test.each([undefined, false] as const)(
  "fills exact DeepSeek metadata and preserves advertised attachment=%s",
  async (attachment) => {
    vi.stubEnv("AX_CODE_TRUST_PROJECT_CONFIG", "1")
    await using api = await endpoint((_req, res) => {
      res.end(
        JSON.stringify({
          data: [
            {
              id: "deepseek-flash",
              ...(attachment === undefined
                ? {}
                : {
                    name: "Restricted Flash",
                    capabilities: { attachment, reasoning: false, toolcall: false },
                    limit: { context: 32000, output: 2000 },
                  }),
            },
            { id: "my-deepseek-flash" },
          ],
        }),
      )
    })
    const id = "ax-trust-deepseek-fallback"
    await using tmp = await tmpdir({ config: config(id, api.url) })
    await Auth.set(id, { type: "api", key: "test-token" })
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Provider.ready()
          const model = await Provider.getModel(ProviderID.make(id), ModelID.make("deepseek-flash"))
          if (attachment === undefined) {
            expect(model.name).toBe("DeepSeek V4.1 Flash")
            expect(model.limit).toEqual({ context: 1_000_000, output: 384_000 })
            expect(model.capabilities).toMatchObject({
              reasoning: true,
              toolcall: true,
              interleaved: { field: "reasoning_content" },
            })
            expect(modelDisplayInfo(model.id, model).label).toBe("DeepSeek V4.1 Flash 👀")
          } else {
            expect(model.name).toBe("Restricted Flash")
            expect(model.limit).toEqual({ context: 32000, output: 2000 })
            expect(model.capabilities).toMatchObject({ reasoning: false, toolcall: false, attachment: false })
            expect(modelDisplayInfo(model.id, model).vision).toBe(false)
          }
          const unknown = await Provider.getModel(ProviderID.make(id), ModelID.make("my-deepseek-flash"))
          expect(unknown.capabilities.input.image).toBe(false)
        },
      })
    } finally {
      await Auth.remove(id)
    }
  },
)
