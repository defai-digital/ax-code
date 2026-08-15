import { afterEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { redactProviderInfo } from "../../src/server/routes/config"
import {
  AxEngineConnectionBody,
  AxEngineModelActionBody,
  AxEnginePrepareBody,
  AxEngineStartBody,
  shouldShowProviderInList,
} from "../../src/server/routes/provider"
import { AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID } from "../../src/provider/ax-engine"
import { AxEnginePaths } from "../../src/provider/ax-engine/paths"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("provider routes", () => {
  // Server middleware bootstraps LSP/plugins for every request directory. OAuth
  // routes that omit `?directory=` default to process.cwd() (the monorepo) and
  // leave a heavy instance that Config.updateGlobal must dispose on attach.
  afterEach(async () => {
    await Instance.disposeAll().catch(() => undefined)
  })

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

  test("shows default API and CLI providers on fresh config while hiding Grok Cloud API", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = encodeURIComponent(tmp.path)

    const response = await Server.Default().request(`/provider?directory=${directory}`)
    expect(response.status).toBe(200)

    const body = (await response.json()) as { all: Array<{ id: string }> }
    const ids = body.all.map((provider) => provider.id)
    expect(ids).not.toContain("xai")
    expect(ids).toContain("openrouter")
    expect(ids).toContain("groq")
    expect(ids).toContain("huggingface")
    expect(ids).toContain("unorouter")
    expect(ids).toContain("zai-coding-plan")
    // Cloud API providers (DeepSeek official + Meta Muse Spark)
    expect(ids).toContain("deepseek")
    expect(ids).toContain("meta")
    expect(ids).toContain("alibaba-pai")
    expect(ids).toContain("runpod")
    expect(ids).toContain("huggingface-endpoints")
    expect(ids).toContain("nebius")
    expect(ids).toContain("fireworks-ai")
    expect(ids).toContain("togetherai")
    expect(ids).toContain("baseten")
    expect(ids).toContain("nvidia")
    expect(ids).toContain("deepinfra")
    expect(ids).toContain("volcengine-ark")
    expect(ids).toContain("modelarts")
    expect(ids).toContain("tencent-ti")
    expect(ids).toContain("sagemaker")
    expect(ids).toContain("grok-build-cli")
    expect(ids).toContain("qoder-cli")
    expect(ids).not.toContain("gemini-cli")
    expect(ids).not.toContain("antigravity-cli")
    expect(ids).toContain("kimi-cli")
  })

  test("rejects an empty PAI-EAS connection body", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = encodeURIComponent(tmp.path)
    const response = await Server.Default().request(`/provider/alibaba-pai/connection?directory=${directory}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseURL: "", apiKey: "" }),
    })
    expect(response.status).toBe(400)
  })

  test("rejects an empty or unknown private GPU connection body", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = encodeURIComponent(tmp.path)
    const empty = await Server.Default().request(`/provider/private-gpu/connection?directory=${directory}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerID: "alibaba-pai", baseURL: "", apiKey: "" }),
    })
    expect(empty.status).toBe(400)

    const unknown = await Server.Default().request(`/provider/private-gpu/connection?directory=${directory}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerID: "openai", baseURL: "http://127.0.0.1:9", apiKey: "token" }),
    })
    expect(unknown.status).toBe(400)
  })

  test("rejects a catalog vendor on the dedicated private GPU connection route", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = encodeURIComponent(tmp.path)
    const response = await Server.Default().request(`/provider/private-gpu/connection?directory=${directory}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerID: "fireworks-ai", baseURL: "https://example.com", apiKey: "key" }),
    })
    expect(response.status).toBe(400)

    const nebius = await Server.Default().request(`/provider/private-gpu/connection?directory=${directory}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerID: "nebius", baseURL: "https://api.tokenfactory.nebius.com/v1", apiKey: "key" }),
    })
    expect(nebius.status).toBe(400)
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
    const directory = encodeURIComponent(tmp.path)

    const response = await Server.Default().request(`/provider/xai/oauth/authorize?directory=${directory}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: 999999 }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { name: string; details?: { resource?: string } }
    expect(body.name).toBe("InvalidRequestError")
    expect(body.details?.resource).toBe("providerAuth")
  })

  test("oauth callback without pending auth returns 400 not 500", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = encodeURIComponent(tmp.path)

    const response = await Server.Default().request(`/provider/xai/oauth/callback?directory=${directory}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: 0 }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { name: string; details?: { resource?: string } }
    expect(body.name).toBe("InvalidRequestError")
    expect(body.details?.resource).toBe("providerAuth")
  })

  test("oauth callback coerces method index from string values", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = encodeURIComponent(tmp.path)

    const response = await Server.Default().request(`/provider/xai/oauth/callback?directory=${directory}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "0" }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { name: string; details?: { resource?: string } }
    expect(body.name).toBe("InvalidRequestError")
    expect(body.details?.resource).toBe("providerAuth")
  })

  test("oauth authorize rejects negative method index at validation", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = encodeURIComponent(tmp.path)

    const response = await Server.Default().request(`/provider/xai/oauth/authorize?directory=${directory}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: -1 }),
    })
    expect(response.status).toBe(400)
  })

  test("oauth authorize rejects empty method index at validation", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = encodeURIComponent(tmp.path)

    const response = await Server.Default().request(`/provider/xai/oauth/authorize?directory=${directory}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "" }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { name: string }
    expect(body.name).toBe("InvalidRequestError")
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

  test("ax-engine model action schema accepts empty JSON clients", () => {
    expect(AxEngineModelActionBody.parse({})).toEqual({})
    expect(AxEngineModelActionBody.parse({ quantization: "mlx6bit" })).toEqual({ quantization: "mlx6bit" })
  })

  test("ax-engine connection schema distinguishes managed and attach requests", () => {
    expect(AxEngineConnectionBody.parse({ mode: "managed" })).toEqual({ mode: "managed" })
    expect(
      AxEngineConnectionBody.parse({
        mode: "attach",
        baseURL: "http://127.0.0.1:31418/v1",
        apiKey: "secret",
      }),
    ).toEqual({
      mode: "attach",
      baseURL: "http://127.0.0.1:31418/v1",
      apiKey: "secret",
    })
  })

  test("validates attach mode, encrypts its credential, and can switch back to managed", async () => {
    await using tmp = await tmpdir({ git: true })
    const previousConfigPath = Global.Path.config
    const globalConfigPath = path.join(tmp.path, "global-config")
    const previousServerState = AxEnginePaths.serverState
    const serverStatePath = path.join(tmp.path, "ax-engine-state", "server.json")
    const originalFetch = globalThis.fetch
    await fs.mkdir(globalConfigPath, { recursive: true })
    ;(Global.Path as { config: string }).config = globalConfigPath
    ;(AxEnginePaths as { serverState: string }).serverState = serverStatePath
    Config.global.reset()
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "attached-model",
              capabilities: { toolcall: true },
              limit: { context: 16_384, output: 512 },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch

    try {
      // Drop any leftover instances (e.g. cwd bootstrap from prior tests) so
      // Config.updateGlobal during attach/managed does not wait on their teardown.
      await Instance.disposeAll().catch(() => undefined)

      const app = Server.Default()
      const connectionURL = `/provider/ax-engine/connection?directory=${encodeURIComponent(tmp.path)}`
      const attach = await app.request(connectionURL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "attach",
          baseURL: "127.0.0.1:31418",
          apiKey: "attach-secret",
        }),
      })
      expect(attach.status).toBe(200)
      const attachBody = await attach.json()
      expect(await Auth.get("ax-engine")).toEqual({ type: "api", key: "attach-secret" })

      const configText = await fs.readFile(path.join(globalConfigPath, "ax-code.jsonc"), "utf8")
      expect(configText).not.toContain("attach-secret")
      expect(JSON.parse(configText)).toMatchObject({
        provider: {
          "ax-engine": {
            options: {
              connectionMode: "attach",
              baseURL: "http://127.0.0.1:31418/v1",
              apiKey: "",
            },
          },
        },
      })
      expect(attachBody).toMatchObject({
        mode: "attach",
        baseURL: "http://127.0.0.1:31418/v1",
        ready: true,
        models: ["attached-model"],
      })

      const managed = await app.request(connectionURL, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "managed" }),
      })
      expect(managed.status).toBe(200)
      expect(await managed.json()).toMatchObject({ mode: "managed" })
      expect(await Auth.get("ax-engine")).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
      await Auth.remove("ax-engine")
      ;(AxEnginePaths as { serverState: string }).serverState = previousServerState
      ;(Global.Path as { config: string }).config = previousConfigPath
      Config.global.reset()
    }
  })

  test("ax-engine models route returns the supported model catalog", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = encodeURIComponent(tmp.path)

    const response = await Server.Default().request(`/provider/ax-engine/models?directory=${directory}`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { models: Array<{ id: string }> }
    expect(body.models.map((model) => model.id)).toEqual([
      "qwen3.8-27b-axq-6bit",
      "qwen3.8-27b-axq-4bit",
      "ornith-35b-axq-6bit",
      "ornith-35b-axq-4bit",
      "qwen3-coder-next-axq-6bit",
      "qwen3-coder-next-axq-4bit",
    ])
    expect((body as { catalog?: { source?: string; modelIDs?: string[] } }).catalog).toMatchObject({
      source: "packages/ax-code/src/provider/ax-engine/constants.ts",
      modelIDs: [
        "qwen3.8-27b-axq-6bit",
        "qwen3.8-27b-axq-4bit",
        "ornith-35b-axq-6bit",
        "ornith-35b-axq-4bit",
        "qwen3-coder-next-axq-6bit",
        "qwen3-coder-next-axq-4bit",
      ],
    })
  })

  test("ax-engine model download route rejects unknown model ids", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = encodeURIComponent(tmp.path)

    const response = await Server.Default().request(`/provider/ax-engine/models/nope/download?directory=${directory}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { name: string; details?: { resource?: string } }
    expect(body.name).toBe("InvalidRequestError")
    expect(body.details?.resource).toBe("model")
  })

  test("ax-engine model delete route returns domain errors as 400 responses", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = encodeURIComponent(tmp.path)

    const modelPath = path.join(tmp.path, "external-model")
    const marker = {
      modelID: AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID,
      quantization: "mlx6bit",
      path: modelPath,
      preparedAt: Date.now(),
    }
    await fs.mkdir(modelPath, { recursive: true })
    await fs.writeFile(path.join(modelPath, "ax_mtp_sidecar_manifest.json"), "{}")
    await fs.mkdir(path.dirname(AxEnginePaths.prepareState), { recursive: true })
    await fs.writeFile(AxEnginePaths.prepareState, JSON.stringify(marker))
    await fs.writeFile(AxEnginePaths.completionMarker(modelPath), JSON.stringify(marker))

    const response = await Server.Default().request(
      `/provider/ax-engine/models/${AX_ENGINE_QWEN38_27B_AXQ_6BIT_MODEL_ID}?directory=${directory}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { name: string; message: string; details?: { resource?: string } }
    expect(body.name).toBe("InvalidRequestError")
    expect(body.message).toContain("AX_ENGINE_MODEL_NOT_PREPARED")
    expect(body.details?.resource).toBe("axEngine")
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
