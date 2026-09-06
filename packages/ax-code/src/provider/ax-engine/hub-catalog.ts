import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { Filesystem } from "@/util/filesystem"
import { parseJsonStrict } from "@/util/json-value"
import { ModelsDev } from "../models"
import {
  AX_ENGINE_ERROR,
  AX_ENGINE_MODEL_DEFINITIONS,
  axEngineHubReference,
  isAxEngineBuiltinModelID,
} from "./constants"
import type { AxEngineModelDefinition, AxEngineModelID } from "./constants"
import { AxEnginePaths } from "./paths"
import { HubCatalog, HubModel, evaluateHubModel, hubModelDefinition, hubModelID, hubTextConfig } from "./hub-model"
import bundled from "./hub-catalog-snapshot.json"

export const AxEngineCatalogError = NamedError.create("AxEngineCatalogError", z.object({ message: z.string() }))
const MAX_JSON_BYTES = 8 * 1024 * 1024
const MAX_PAGES = 20

function catalogError(message: string) {
  return new AxEngineCatalogError({ message: `${AX_ENGINE_ERROR.CatalogUnavailable}: ${message}` })
}

function assertHubURL(url: URL) {
  if (
    url.origin !== "https://huggingface.co" ||
    url.username ||
    url.password ||
    !["/api/models", "/AutomatosX/", "/api/resolve-cache/models/AutomatosX/"].some((prefix) =>
      url.pathname.startsWith(prefix),
    )
  ) {
    throw catalogError("Unexpected Hugging Face metadata URL")
  }
}

async function readResponse(response: Response) {
  if (!response.body) throw catalogError("Missing metadata response body")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_JSON_BYTES) throw catalogError("Metadata response exceeds the size limit")
      chunks.push(chunk.value)
    }
    return parseJsonStrict(Buffer.concat(chunks).toString("utf8"))
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

async function fetchJSON(url: URL, fetcher: typeof fetch, signal: AbortSignal) {
  for (let redirect = 0; redirect < 4; redirect++) {
    assertHubURL(url)
    signal.throwIfAborted()
    const response = await fetcher(url, { signal, redirect: "manual", headers: { accept: "application/json" } })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location")
      await response.body?.cancel()
      if (!location) throw catalogError("Metadata redirect has no location")
      url = new URL(location, url)
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw catalogError(`Hugging Face metadata request failed with HTTP ${response.status}`)
    }
    return { value: await readResponse(response), link: response.headers.get("link") }
  }
  throw catalogError("Too many metadata redirects")
}

async function readCached(file: string) {
  const stat = await fs.stat(file)
  if (!stat.isFile() || stat.size > MAX_JSON_BYTES) throw catalogError("Invalid metadata cache file")
  return parseJsonStrict(await fs.readFile(file, "utf8"))
}

export type HubCatalogView = {
  catalog: HubCatalog
  source: "bundled" | "cache" | "remote"
  warnings: string[]
}

/** Isolated store also lets tests exercise the real fetch/cache contract. */
export function createHubCatalogStore(input: {
  cachePath: string
  artifactPath: (id: AxEngineModelID) => string
  bundled: unknown
  fetch?: typeof fetch
  productCatalog?: () => Promise<Record<string, ModelsDev.Provider>>
  pinnedModels?: () => Promise<unknown[]>
}) {
  let current: Promise<HubCatalogView> | undefined
  const productCatalog = input.productCatalog ?? ModelsDev.get
  const fetcher: typeof fetch = input.fetch ?? ((...args) => globalThis.fetch(...args))

  async function load(): Promise<HubCatalogView> {
    current ??= (async () => {
      try {
        return { catalog: HubCatalog.parse(await readCached(input.cachePath)), source: "cache" as const, warnings: [] }
      } catch (error) {
        const absent = Filesystem.errnoCode(error) === "ENOENT"
        return {
          catalog: HubCatalog.parse(input.bundled),
          source: "bundled" as const,
          warnings: absent ? [] : [`Cached catalog unavailable: ${NamedError.message(error)}`],
        }
      }
    })()
    return current
  }

  async function fetchModel(id: AxEngineModelID, signal: AbortSignal): Promise<HubModel> {
    const ref = axEngineHubReference(id)
    if (!ref) throw catalogError("Expected a pinned Hub model")
    const response = await fetchJSON(
      new URL(`https://huggingface.co/api/models/${ref.repoID}/revision/${ref.revision}?blobs=true`),
      fetcher,
      signal,
    )
    const model = HubModel.parse(response.value)
    if (hubModelID(model) !== id) throw catalogError("Metadata revision does not match the requested artifact")
    const file = (name: string) =>
      fetchJSON(new URL(`https://huggingface.co/${ref.repoID}/resolve/${ref.revision}/${name}`), fetcher, signal)
    const config = await file("config.json")
    model.textConfig = hubTextConfig(config.value)
    if (model.siblings.some((entry) => entry.rfilename === "axquant_manifest.json")) {
      const artifact = await file("axquant_manifest.json")
      const parsed = z
        .object({ source_model: z.object({ model_id: z.string().max(256).optional() }).optional() })
        .parse(artifact.value)
      model.provenanceBase = parsed.source_model?.model_id
    }
    return model
  }

  async function refresh(options: { signal?: AbortSignal } = {}): Promise<HubCatalogView> {
    options.signal?.throwIfAborted()
    const signal = AbortSignal.any([AbortSignal.timeout(45_000), ...(options.signal ? [options.signal] : [])])
    const previous = await load()
    try {
      const catalog = await productCatalog()
      const models: HubModel[] = []
      const seen = new Set<string>()
      let url: URL | undefined = new URL(
        "https://huggingface.co/api/models?author=AutomatosX&limit=100&full=true&cardData=true",
      )
      for (let page = 0; url && page < MAX_PAGES; page++) {
        if (url.pathname !== "/api/models" || url.searchParams.get("author") !== "AutomatosX") {
          throw catalogError("Unexpected catalog pagination scope")
        }
        const result = await fetchJSON(url, fetcher, signal)
        const rows = z.array(HubModel).max(100).parse(result.value)
        for (const model of rows) {
          const id = hubModelID(model)
          if (!seen.has(id)) {
            models.push(model)
            seen.add(id)
          }
        }
        const next = result.link?.match(/<([^>]+)>;\s*rel="next"/)?.[1]
        url = next ? new URL(next, url) : undefined
      }
      if (url) throw catalogError("Catalog exceeds the pagination limit")
      const warnings: string[] = []
      let next = 0
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (next < models.length) {
            const index = next++
            const model = models[index]
            if (evaluateHubModel(model, catalog).policy !== "eligible") continue
            const cached = previous.catalog.models.find((entry) => hubModelID(entry) === hubModelID(model))
            if (cached && hubModelDefinition(cached, evaluateHubModel(cached, catalog))) {
              models[index] = cached
              continue
            }
            try {
              models[index] = await fetchModel(hubModelID(model), signal)
            } catch (error) {
              signal.throwIfAborted()
              warnings.push(`${model.id}: ${NamedError.message(error)}`)
            }
          }
        }),
      )
      signal.throwIfAborted()
      const fresh = HubCatalog.parse({ version: 1, fetchedAt: Date.now(), models })
      await Filesystem.writeJson(input.cachePath, fresh, 0o600)
      const view: HubCatalogView = { catalog: fresh, source: "remote", warnings }
      current = Promise.resolve(view)
      return view
    } catch (error) {
      options.signal?.throwIfAborted()
      return {
        ...previous,
        warnings: [...previous.warnings, `Refresh failed; retained cached catalog: ${NamedError.message(error)}`],
      }
    }
  }

  async function inspect(options: { refresh?: boolean; signal?: AbortSignal } = {}) {
    const view = options.refresh ? await refresh(options) : await load()
    const catalog = await productCatalog()
    const models = new Map(view.catalog.models.map((model) => [hubModelID(model), model]))
    const warnings = [...view.warnings]
    try {
      for (const raw of (await input.pinnedModels?.()) ?? []) {
        const model = HubModel.parse(raw)
        if (!models.has(hubModelID(model))) models.set(hubModelID(model), model)
      }
    } catch (error) {
      warnings.push(`Pinned catalog unavailable: ${NamedError.message(error)}`)
    }
    const entries = [...models.values()]
    const decisions = entries.map((model) => evaluateHubModel(model, catalog))
    const definitions = entries.flatMap((model, index) => {
      const definition = hubModelDefinition(model, decisions[index])
      if (definition) {
        const curated = Object.values(AX_ENGINE_MODEL_DEFINITIONS).some((entry) =>
          Object.values(entry.quantizations).some((quant) => quant.hfRepo === model.id),
        )
        return curated ? [] : [definition]
      }
      if (decisions[index].policy === "eligible")
        decisions[index] = {
          ...decisions[index],
          reason: "Source accepted; complete package metadata is unavailable. Refresh the catalog.",
        }
      return []
    })
    return { ...view, warnings, decisions, definitions }
  }

  async function resolve(
    id: AxEngineModelID,
    options: { signal?: AbortSignal; persist?: boolean; offline?: boolean } = {},
  ): Promise<AxEngineModelDefinition> {
    if (isAxEngineBuiltinModelID(id)) return AX_ENGINE_MODEL_DEFINITIONS[id]
    options.signal?.throwIfAborted()
    const view = await load()
    let model = view.catalog.models.find((entry) => hubModelID(entry) === id)
    if (!model) {
      try {
        model = HubModel.parse(await readCached(input.artifactPath(id)))
      } catch (error) {
        if (Filesystem.errnoCode(error) !== "ENOENT")
          throw catalogError(`Pinned metadata is invalid: ${NamedError.message(error)}`)
      }
      if (model && hubModelID(model) !== id) throw catalogError("Pinned metadata identity mismatch")
    }
    const catalog = await productCatalog()
    if (
      !model ||
      (evaluateHubModel(model, catalog).policy === "eligible" &&
        !hubModelDefinition(model, evaluateHubModel(model, catalog)))
    ) {
      if (options.offline) throw catalogError("Pinned package metadata is unavailable offline")
      const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(options.signal ? [options.signal] : [])])
      model = await fetchModel(id, signal)
    }
    const decision = evaluateHubModel(model, catalog)
    const definition = hubModelDefinition(model, decision)
    if (!definition)
      throw new AxEngineCatalogError({ message: `${AX_ENGINE_ERROR.ModelUnsupported}: ${decision.reason}` })
    options.signal?.throwIfAborted()
    if (options.persist) await Filesystem.writeJson(input.artifactPath(id), model, 0o600)
    return definition
  }

  return { load, refresh, inspect, resolve }
}

export const axEngineHubCatalog = createHubCatalogStore({
  cachePath: AxEnginePaths.hubCatalog,
  artifactPath: AxEnginePaths.hubArtifact,
  bundled,
  async pinnedModels() {
    const entries = await fs.readdir(AxEnginePaths.hubArtifacts).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    if (entries.length > 2_000) throw catalogError("Too many pinned artifact records")
    const result: unknown[] = []
    for (const entry of entries) {
      if (!/^[a-f0-9]{64}\.json$/.test(entry)) continue
      const raw = HubModel.parse(await readCached(path.join(AxEnginePaths.hubArtifacts, entry)))
      if (path.basename(AxEnginePaths.hubArtifact(hubModelID(raw))) !== entry)
        throw catalogError("Pinned artifact filename does not match its identity")
      result.push(raw)
    }
    return result
  },
})

export const resolveAxEngineModelDefinition = axEngineHubCatalog.resolve
