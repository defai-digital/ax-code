import { describe, expect, test } from "vitest"
import { Auth } from "../../src/auth"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { redactProviderInfo } from "../../src/server/routes/config"
import { AxEnginePrepareBody, AxEngineStartBody, shouldShowProviderInList } from "../../src/server/routes/provider"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("provider routes", () => {
  test("rejects auth updates before writing when directory is invalid", async () => {
    const providerID = "provider-invalid-dir-test"
    const response = await Server.Default().request(`/auth/${providerID}?directory=relative`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "api", key: "should-not-write" }),
    })

    expect(response.status).toBe(400)
    expect(await Auth.get(providerID)).toBeUndefined()
  })

  test("updates auth routes with request directory context", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = encodeURIComponent(tmp.path)
    const app = Server.Default()

    const put = await app.request(`/auth/xai?directory=${directory}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "api", key: "test-key" }),
    })
    const del = await app.request(`/auth/xai?directory=${directory}`, {
      method: "DELETE",
    })

    expect(put.status).toBe(200)
    expect(await put.json()).toBe(true)
    expect(del.status).toBe(200)
    expect(await del.json()).toBe(true)
  })

  test("shows OpenRouter, GroqCloud, z.ai, and CLI providers on fresh config while hiding Grok Cloud API", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.Default().request("/provider")
        expect(response.status).toBe(200)

        const body = (await response.json()) as { all: Array<{ id: string }> }
        const ids = body.all.map((provider) => provider.id)
        expect(ids).not.toContain("xai")
        expect(ids).toContain("openrouter")
        expect(ids).toContain("groq")
        expect(ids).toContain("zai-coding-plan")
        expect(ids).toContain("grok-build-cli")
        expect(ids).toContain("qoder-cli")
        expect(ids).toContain("antigravity-cli")
      },
    })
  })

  test("allows explicitly enabled Grok Cloud API in provider list", () => {
    expect(
      shouldShowProviderInList({
        key: "xai",
        disabled: new Set(),
      }),
    ).toBe(false)
    expect(
      shouldShowProviderInList({
        key: "xai",
        disabled: new Set(),
        enabled: new Set(["xai"]),
      }),
    ).toBe(true)
  })

  test("oauth authorize with invalid method index returns 400 not 500", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.Default().request(`/provider/xai/oauth/authorize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: 999999 }),
        })
        expect(response.status).toBe(400)
        const body = (await response.json()) as { name: string; details?: { resource?: string } }
        expect(body.name).toBe("InvalidRequestError")
        expect(body.details?.resource).toBe("providerAuth")
      },
    })
  })

  test("oauth callback without pending auth returns 400 not 500", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.Default().request(`/provider/xai/oauth/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: 0 }),
        })
        expect(response.status).toBe(400)
        const body = (await response.json()) as { name: string; details?: { resource?: string } }
        expect(body.name).toBe("InvalidRequestError")
        expect(body.details?.resource).toBe("providerAuth")
      },
    })
  })

  test("oauth callback coerces method index from string values", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.Default().request(`/provider/xai/oauth/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: "0" }),
        })
        expect(response.status).toBe(400)
        const body = (await response.json()) as { name: string; details?: { resource?: string } }
        expect(body.name).toBe("InvalidRequestError")
        expect(body.details?.resource).toBe("providerAuth")
      },
    })
  })

  test("oauth authorize rejects negative method index at validation", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.Default().request(`/provider/xai/oauth/authorize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: -1 }),
        })
        expect(response.status).toBe(400)
      },
    })
  })

  test("oauth authorize rejects empty method index at validation", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.Default().request(`/provider/xai/oauth/authorize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: "" }),
        })
        expect(response.status).toBe(400)
        const body = (await response.json()) as { name: string }
        expect(body.name).toBe("InvalidRequestError")
      },
    })
  })

  test("ax-engine request schemas parse string boolean flags from JSON clients", () => {
    const prepare = AxEnginePrepareBody.parse({
      download: "false",
      start: "true",
    })
    expect(prepare.download).toBe(false)
    expect(prepare.start).toBe(true)

    const start = AxEngineStartBody.parse({
      download: "0",
    })
    expect(start.download).toBe(false)
  })

  test("redactProviderInfo drops the key and masks secret-bearing options", () => {
    const redacted = redactProviderInfo({
      id: "openai",
      name: "OpenAI",
      env: [],
      source: "config",
      key: "sk-top-secret",
      options: { apiKey: "sk-top-secret", accessToken: "oauth-tok", baseURL: "https://example.test/v1" },
      models: {},
    } as any)

    // The top-level credential and any secret-looking option value must be
    // redacted; non-secret options (baseURL) are preserved.
    expect(redacted.key).toBeUndefined()
    expect((redacted.options as Record<string, unknown>).apiKey).toBe("[redacted]")
    expect((redacted.options as Record<string, unknown>).accessToken).toBe("[redacted]")
    expect((redacted.options as Record<string, unknown>).baseURL).toBe("https://example.test/v1")
  })
})
