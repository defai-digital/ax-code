import fs from "node:fs/promises"
import { constants } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { describe, expect, test, vi } from "vitest"
import { tmpdir } from "../../fixture/fixture"
import { createHubCatalogStore } from "../../../src/provider/ax-engine/hub-catalog"
import { hubModelID } from "../../../src/provider/ax-engine/hub-model"
import { hubFixture, productCatalog } from "./hub-fixture"

function storeInput(directory: string, models = [hubFixture()]) {
  return {
    cachePath: path.join(directory, "catalog.json"),
    artifactPath: (id: string) => path.join(directory, `${encodeURIComponent(id)}.json`),
    bundled: { version: 1, fetchedAt: 1, models },
    productCatalog: async () => productCatalog(),
  }
}

describe("AutomatosX metadata store", () => {
  test("loads bundled candidates offline without fetching weights or metadata", async () => {
    await using tmp = await tmpdir()
    const fetcher = vi.fn<typeof fetch>()
    const store = createHubCatalogStore({ ...storeInput(tmp.path), fetch: fetcher })
    const result = await store.inspect()
    expect(result.source).toBe("bundled")
    expect(result.definitions).toHaveLength(1)
    expect(fetcher).not.toHaveBeenCalled()
  })

  test("refreshes paginated metadata and hydrates only eligible sources at the pinned revision", async () => {
    await using tmp = await tmpdir()
    const model = hubFixture({ sha: "b".repeat(40) })
    const asr = hubFixture({ id: "AutomatosX/AX-Qwen3-ASR-MLX-4bit", pipeline_tag: "automatic-speech-recognition" })
    const fetcher = vi.fn<typeof fetch>(async (request) => {
      const url = new URL(String(request))
      if (url.pathname === "/api/models") {
        if (url.searchParams.has("cursor")) return Response.json([asr])
        return Response.json(
          [{ ...model, textConfig: undefined, siblings: model.siblings.map(({ rfilename }) => ({ rfilename })) }],
          {
            headers: { link: '<https://huggingface.co/api/models?author=AutomatosX&cursor=next>; rel="next"' },
          },
        )
      }
      if (url.pathname === `/api/models/${model.id}/revision/${model.sha}`) return Response.json(model)
      if (url.pathname.endsWith(`/${model.sha}/config.json`)) return Response.json({ text_config: model.textConfig })
      throw new Error(`Unexpected request ${url}`)
    })
    const store = createHubCatalogStore({ ...storeInput(tmp.path), fetch: fetcher })
    const result = await store.inspect({ refresh: true })
    expect(result.source).toBe("remote")
    expect(result.warnings).toEqual([])
    expect(result.definitions.map((entry) => entry.id)).toEqual([hubModelID(model)])
    expect(result.decisions.map((entry) => entry.policy)).toEqual(["eligible", "excluded"])
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect((await createHubCatalogStore(storeInput(tmp.path)).inspect()).source).toBe("cache")
  })

  test.each(["HTTP", "invalid-json", "wrong-owner", "redirect", "pagination"])(
    "retains the last complete catalog on %s failures",
    async (failure) => {
      await using tmp = await tmpdir()
      const fetcher = vi.fn<typeof fetch>(async () => {
        if (failure === "HTTP") return new Response("busy", { status: 503 })
        if (failure === "invalid-json") return new Response("invalid")
        if (failure === "wrong-owner") return Response.json([hubFixture(), { ...hubFixture(), id: "Another/model" }])
        if (failure === "redirect")
          return new Response(null, { status: 302, headers: { location: "https://example.com/model" } })
        return Response.json([hubFixture()], {
          headers: { link: '<https://huggingface.co/api/models?author=Another>; rel="next"' },
        })
      })
      const store = createHubCatalogStore({ ...storeInput(tmp.path), fetch: fetcher })
      const result = await store.inspect({ refresh: true })
      expect(result.source).toBe("bundled")
      expect(result.definitions).toHaveLength(1)
      expect(result.warnings.join(" ")).toContain("Refresh failed")
      expect(fetcher.mock.calls.every(([url]) => String(url).startsWith("https://huggingface.co/"))).toBe(true)
    },
  )

  test("rejects oversized response bodies and keeps offline operation available", async () => {
    await using tmp = await tmpdir()
    const fetcher = vi.fn<typeof fetch>(async () => new Response(" ".repeat(8 * 1024 * 1024 + 1)))
    const result = await createHubCatalogStore({ ...storeInput(tmp.path), fetch: fetcher }).inspect({ refresh: true })
    expect(result.warnings.join(" ")).toContain("size limit")
    expect(result.definitions).toHaveLength(1)
  })

  test("preserves caller cancellation instead of returning an apparently successful refresh", async () => {
    await using tmp = await tmpdir()
    const controller = new AbortController()
    const fetcher = vi.fn<typeof fetch>(async () => {
      controller.abort()
      throw controller.signal.reason
    })
    const store = createHubCatalogStore({ ...storeInput(tmp.path), fetch: fetcher })
    await expect(store.refresh({ signal: controller.signal })).rejects.toThrow()
    expect((await store.load()).catalog.fetchedAt).toBe(1)
  })

  test("keeps prepared revisions resolvable and discoverable after a newer catalog is installed", async () => {
    await using tmp = await tmpdir()
    const input = storeInput(tmp.path)
    const old = hubFixture()
    const id = hubModelID(old)
    await createHubCatalogStore(input).resolve(id, { persist: true })
    const fetcher = vi.fn<typeof fetch>()
    const restarted = createHubCatalogStore({
      ...storeInput(tmp.path, [hubFixture({ sha: "b".repeat(40) })]),
      fetch: fetcher,
      pinnedModels: async () => [old],
    })
    expect((await restarted.resolve(id)).revision).toBe(old.sha)
    expect((await restarted.inspect()).definitions.map((entry) => entry.id)).toContain(id)
    expect(fetcher).not.toHaveBeenCalled()
  })

  test("rejects a metadata response for a different revision", async () => {
    await using tmp = await tmpdir()
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(hubFixture({ sha: "b".repeat(40) })))
    const store = createHubCatalogStore({ ...storeInput(tmp.path, []), fetch: fetcher })
    await expect(store.resolve(hubModelID(hubFixture()))).rejects.toThrow("revision does not match")
  })

  test("reports damaged cache metadata and falls back to the bundled catalog", async () => {
    await using tmp = await tmpdir()
    const input = storeInput(tmp.path)
    await fs.writeFile(input.cachePath, "broken")
    const result = await createHubCatalogStore(input).inspect()
    expect(result.source).toBe("bundled")
    expect(result.warnings.join(" ")).toContain("Cached catalog unavailable")
  })
})

test("historical offline metadata survives provider catalog removal without granting eligibility", async () => {
  await using tmp = await tmpdir()
  const model = hubFixture({ id: "AutomatosX/AX-Qwen3.8-27B-MLX-6bit" })
  const fetcher = vi.fn<typeof fetch>()
  const store = createHubCatalogStore({
    ...storeInput(tmp.path, [model]),
    productCatalog: async () => ({}),
    fetch: fetcher,
  })
  const id = hubModelID(model)
  expect((await store.inspect()).definitions).toEqual([])
  await expect(store.resolve(id)).rejects.toThrow("AX_ENGINE_MODEL_UNSUPPORTED")
  expect(await store.resolve(id, { offline: true })).toMatchObject({
    id,
    revision: model.sha,
    sourceModel: "Qwen/Qwen3.8-27B",
    toolcall: false,
    artifactFiles: ["config.json", "model.safetensors"],
  })
  expect(fetcher).not.toHaveBeenCalled()
  const incomplete = createHubCatalogStore({
    ...storeInput(tmp.path, [hubFixture({ id: model.id, siblings: [{ rfilename: "model.safetensors" }] })]),
    productCatalog: async () => ({}),
    fetch: fetcher,
  })
  await expect(incomplete.resolve(id, { offline: true })).rejects.toThrow("AX_ENGINE_MODEL_UNSUPPORTED")
})

test("selected AXQ metadata cannot bypass source admission through offline resolution", async () => {
  await using tmp = await tmpdir()
  const model = hubFixture({ id: "AutomatosX/AX-Tiel-Coder-35B-A3B-MLX-AXQ-MXFP4-MTP" })
  const fetcher = vi.fn<typeof fetch>()
  const store = createHubCatalogStore({
    ...storeInput(tmp.path, [model]),
    productCatalog: async () => ({}),
    fetch: fetcher,
  })
  await expect(store.resolve(hubModelID(model), { offline: true })).rejects.toThrow("AX_ENGINE_MODEL_UNSUPPORTED")
  expect(fetcher).not.toHaveBeenCalled()
})

test.skipIf(process.platform === "win32")("FIFO metadata cache falls back without waiting for a writer", async () => {
  await using tmp = await tmpdir()
  const input = storeInput(tmp.path)
  execFileSync("mkfifo", [input.cachePath])
  const pending = createHubCatalogStore(input).load()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Metadata cache blocked on FIFO open")), 1_000)
      }),
    ])
    expect(result.source).toBe("bundled")
    expect(result.warnings.join(" ")).toContain("Invalid metadata cache file")
  } finally {
    clearTimeout(timer)
    const writer = await fs.open(input.cachePath, constants.O_RDWR | constants.O_NONBLOCK)
    await pending
    await writer.close()
  }
})

test("metadata-only refresh retains exact bundled historical status without re-enabling selection", async () => {
  await using tmp = await tmpdir()
  const model = hubFixture({ id: "AutomatosX/AX-Qwen3.8-27B-MLX-AXQ-6bit-MTP" })
  const input = storeInput(tmp.path, [model])
  await fs.writeFile(
    input.cachePath,
    JSON.stringify({
      version: 1,
      fetchedAt: 2,
      models: [{ ...model, siblings: [{ rfilename: "model.safetensors" }] }],
    }),
  )
  const fetcher = vi.fn<typeof fetch>()
  const store = createHubCatalogStore({ ...input, productCatalog: async () => ({}), fetch: fetcher })
  expect((await store.inspect()).definitions).toEqual([])
  expect(await store.resolve(hubModelID(model), { offline: true })).toMatchObject({
    revision: model.sha,
    artifactFiles: ["config.json", "model.safetensors"],
  })
  expect(fetcher).not.toHaveBeenCalled()
})
