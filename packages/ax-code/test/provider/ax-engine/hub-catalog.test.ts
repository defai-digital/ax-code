import fs from "node:fs/promises"
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
