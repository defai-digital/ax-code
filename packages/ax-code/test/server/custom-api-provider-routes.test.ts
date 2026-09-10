import { afterEach, describe, expect, test } from "vitest"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

const TEST_PROVIDER_IDS = ["company-gateway", "loopback-gateway"]

afterEach(async () => {
  for (const providerID of TEST_PROVIDER_IDS) {
    await Config.removeGlobalProvider(providerID).catch(() => undefined)
    await Auth.remove(providerID).catch(() => undefined)
  }
  await Instance.disposeAll().catch(() => undefined)
})

function providerBody(input?: Partial<Record<string, unknown>>) {
  return {
    name: "Company Gateway",
    protocol: "openai-compatible",
    baseURL: "https://api.example.com/v1",
    apiKey: "test-token",
    models: [
      {
        id: "company-model",
        name: "Company Model",
        contextWindow: 128_000,
        outputLimit: 16_384,
        toolCall: true,
        reasoning: false,
        attachment: true,
        temperature: true,
      },
    ],
    ...input,
  }
}

describe("managed custom API provider routes", () => {
  test.each(["custom-api", "ax-trust"])(
    "creates, lists, replaces, and deletes %s metadata without returning the token",
    async (management) => {
      await using tmp = await tmpdir({ git: true })
      const query = `directory=${encodeURIComponent(tmp.path)}`
      const app = Server.Default()

      const create = await app.request(`/provider/custom/company-gateway?${query}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerBody(management === "ax-trust" ? { management } : undefined)),
      })
      expect(create.status).toBe(200)
      const created = (await create.json()) as Record<string, unknown>
      expect(created).toMatchObject({
        providerID: "company-gateway",
        name: "Company Gateway",
        protocol: "openai-compatible",
        baseURL: "https://api.example.com/v1",
        hasApiKey: true,
      })
      expect(created).not.toHaveProperty("apiKey")
      if (management === "ax-trust") expect(created.management).toBe("ax-trust")
      else expect(created).not.toHaveProperty("management")
      expect(await Auth.get("company-gateway")).toEqual({ type: "api", key: "test-token" })

      const saved = (await Config.getGlobal()).provider?.["company-gateway"]
      expect(saved).toMatchObject({
        management,
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "https://api.example.com/v1" },
      })
      expect(saved?.options).not.toHaveProperty("apiKey")

      const update = await app.request(`/provider/custom/company-gateway?${query}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          providerBody({
            protocol: "anthropic-compatible",
            baseURL: "https://anthropic.example.com",
            apiKey: undefined,
            models: [
              {
                id: "replacement-model",
                contextWindow: 200_000,
                outputLimit: 32_000,
                toolCall: true,
                reasoning: true,
                attachment: false,
                temperature: false,
              },
            ],
          }),
        ),
      })
      expect(update.status).toBe(200)
      expect(await Auth.get("company-gateway")).toEqual({ type: "api", key: "test-token" })
      const updated = (await Config.getGlobal()).provider?.["company-gateway"]
      expect(updated?.management).toBe(management)
      expect(updated?.npm).toBe("@ai-sdk/anthropic")
      expect(Object.keys(updated?.models ?? {})).toEqual(["replacement-model"])

      const list = await app.request(`/provider/custom?${query}`)
      expect(list.status).toBe(200)
      expect(await list.json()).toEqual([expect.objectContaining({ providerID: "company-gateway", hasApiKey: true })])

      const remove = await app.request(`/provider/custom/company-gateway?${query}`, { method: "DELETE" })
      expect(remove.status).toBe(200)
      expect(await remove.json()).toBe(true)
      expect((await Config.getGlobal()).provider?.["company-gateway"]).toBeUndefined()
      expect(await Auth.get("company-gateway")).toBeUndefined()
    },
  )

  test("moves an existing custom gateway to AX Trust without changing its ID, key, or models", async () => {
    await using tmp = await tmpdir({ git: true })
    const query = `directory=${encodeURIComponent(tmp.path)}`
    const app = Server.Default()
    const created = await app.request(`/provider/custom/company-gateway?${query}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(providerBody()),
    })
    expect(created.status).toBe(200)
    const updated = await app.request(`/provider/custom/company-gateway?${query}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(providerBody({ management: "ax-trust", apiKey: undefined, models: undefined })),
    })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({
      providerID: "company-gateway",
      management: "ax-trust",
      hasApiKey: true,
      models: [expect.objectContaining({ id: "company-model" })],
    })
    expect((await Config.getGlobal()).provider?.["company-gateway"]?.management).toBe("ax-trust")
    expect(await Auth.get("company-gateway")).toEqual({ type: "api", key: "test-token" })
  })

  test("requires acknowledgement for remote HTTP while allowing loopback HTTP", async () => {
    await using tmp = await tmpdir({ git: true })
    const query = `directory=${encodeURIComponent(tmp.path)}`
    const app = Server.Default()
    const rejected = await app.request(`/provider/custom/company-gateway?${query}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(providerBody({ baseURL: "http://10.0.0.5/v1", apiKey: undefined })),
    })
    expect(rejected.status).toBe(400)

    const loopback = await app.request(`/provider/custom/loopback-gateway?${query}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(providerBody({ baseURL: "http://127.0.0.1:9000/v1", apiKey: undefined })),
    })
    expect(loopback.status).toBe(200)
  })

  test("DELETE /auth removes AX Trust endpoint metadata, not just the token", async () => {
    await using tmp = await tmpdir({ git: true })
    const query = `directory=${encodeURIComponent(tmp.path)}`
    const app = Server.Default()

    const create = await app.request(`/provider/custom/company-gateway?${query}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(providerBody({ management: "ax-trust" })),
    })
    expect(create.status).toBe(200)
    expect((await Config.getGlobal()).provider?.["company-gateway"]?.management).toBe("ax-trust")
    expect(await Auth.get("company-gateway")).toEqual({ type: "api", key: "test-token" })

    const remove = await app.request(`/auth/company-gateway?${query}`, { method: "DELETE" })
    expect(remove.status).toBe(200)
    expect(await remove.json()).toBe(true)
    expect((await Config.getGlobal()).provider?.["company-gateway"]).toBeUndefined()
    expect(await Auth.get("company-gateway")).toBeUndefined()
  })

  test("DELETE /auth still clears leftover AX Trust config after the token is already gone", async () => {
    await using tmp = await tmpdir({ git: true })
    const query = `directory=${encodeURIComponent(tmp.path)}`
    const app = Server.Default()

    const create = await app.request(`/provider/custom/company-gateway?${query}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(providerBody({ management: "ax-trust" })),
    })
    expect(create.status).toBe(200)
    await Auth.remove("company-gateway")
    expect(await Auth.get("company-gateway")).toBeUndefined()
    expect((await Config.getGlobal()).provider?.["company-gateway"]?.management).toBe("ax-trust")

    const remove = await app.request(`/auth/company-gateway?${query}`, { method: "DELETE" })
    expect(remove.status).toBe(200)
    expect((await Config.getGlobal()).provider?.["company-gateway"]).toBeUndefined()
  })

  test("rejects built-in IDs, embedded URL credentials, duplicate models, and unsafe limits", async () => {
    await using tmp = await tmpdir({ git: true })
    const query = `directory=${encodeURIComponent(tmp.path)}`
    const app = Server.Default()
    const inputs = [
      ["openai", providerBody({ apiKey: undefined })],
      ["company-gateway", providerBody({ baseURL: "https://user:password@example.com/v1", apiKey: undefined })],
      [
        "company-gateway",
        providerBody({
          apiKey: undefined,
          models: [providerBody().models[0], providerBody().models[0]],
        }),
      ],
      [
        "company-gateway",
        providerBody({
          apiKey: undefined,
          models: [{ ...providerBody().models[0], contextWindow: 100, outputLimit: 101 }],
        }),
      ],
    ] as const
    for (const [providerID, body] of inputs) {
      const response = await app.request(`/provider/custom/${providerID}?${query}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(400)
    }
  })
})

describe("managed custom API provider model refresh", () => {
  test("reloads models from GET /models in place with the stored token", async () => {
    await using tmp = await tmpdir({ git: true })
    const query = `directory=${encodeURIComponent(tmp.path)}`
    const app = Server.Default()

    const create = await app.request(`/provider/custom/loopback-gateway?${query}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(providerBody({ name: "Loopback Gateway", baseURL: "http://127.0.0.1:18080/v1" })),
    })
    expect(create.status).toBe(200)

    const originalFetch = globalThis.fetch
    const seen: { url: string; authorization: string | null }[] = []
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") })
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "fresh-model",
              limit: { context: 200_000, output: 8_192 },
              capabilities: { reasoning: true, toolcall: true, temperature: true, attachment: false },
            },
          ],
        }),
        { status: 200 },
      )
    }) as typeof fetch
    try {
      const refresh = await app.request(`/provider/custom/loopback-gateway?${query}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Loopback Gateway",
          protocol: "openai-compatible",
          baseURL: "http://127.0.0.1:18080/v1",
          refreshModels: true,
        }),
      })
      expect(refresh.status).toBe(200)
      const view = (await refresh.json()) as { hasApiKey: boolean; models: Record<string, unknown>[] }
      expect(view.hasApiKey).toBe(true)
      expect(view.models).toEqual([
        expect.objectContaining({ id: "fresh-model", contextWindow: 200_000, outputLimit: 8_192, reasoning: true }),
      ])
      // Other loaders probe local hosts through the same global fetch; only
      // the discovery call for this provider matters here.
      expect(seen.filter((call) => call.url === "http://127.0.0.1:18080/v1/models")).toEqual([
        { url: "http://127.0.0.1:18080/v1/models", authorization: "Bearer test-token" },
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
