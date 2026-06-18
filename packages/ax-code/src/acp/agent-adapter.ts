import { type ToolKind } from "@agentclientprotocol/sdk"
import { applyPatch } from "diff"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { providerModelKey } from "../provider/model-key"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { Log } from "../util/log"
import type { ACPConfig } from "./types"

type ParsedACPResource = { type: "file"; url: string; filename: string; mime: string } | { type: "text"; text: string }

export type ModelOption = { modelId: string; name: string }

const log = Log.create({ service: "acp-agent" })
const DEFAULT_VARIANT_VALUE = "default"

export function toToolKind(toolName: string): ToolKind {
  const tool = toolName.toLocaleLowerCase()
  switch (tool) {
    case "bash":
      return "execute"
    case "webfetch":
      return "fetch"

    case "edit":
    case "patch":
    case "write":
      return "edit"

    case "grep":
    case "glob":
    case "context7_resolve_library_id":
    case "context7_get_library_docs":
      return "search"

    case "list":
    case "read":
      return "read"

    default:
      return "other"
  }
}

export function toLocations(toolName: string, input: Record<string, any>): { path: string }[] {
  const tool = toolName.toLocaleLowerCase()
  switch (tool) {
    case "read":
    case "edit":
    case "write":
      return input["filePath"] ? [{ path: input["filePath"] }] : []
    case "glob":
    case "grep":
      return input["path"] ? [{ path: input["path"] }] : []
    case "bash":
      return []
    case "list":
      return input["path"] ? [{ path: input["path"] }] : []
    default:
      return []
  }
}

export async function defaultModel(
  config: ACPConfig,
  cwd?: string,
): Promise<{ providerID: ProviderID; modelID: ModelID }> {
  const sdk = config.sdk
  const configured = config.defaultModel
  if (configured) return configured

  const directory = cwd ?? process.cwd()

  const specified = await sdk.config
    .get({ directory }, { throwOnError: true })
    .then((resp) => {
      const cfg = resp.data
      if (!cfg || !cfg.model) return undefined
      return Provider.parseModel(cfg.model)
    })
    .catch((error) => {
      log.error("failed to load user config for default model", { error })
      return undefined
    })

  const providers = await sdk.config
    .providers({ directory }, { throwOnError: true })
    .then((x) => x.data?.providers ?? [])
    .catch((error) => {
      log.error("failed to list providers for default model", { error })
      return []
    })

  if (specified && providers.length) {
    const provider = providers.find((p) => p.id === specified.providerID)
    if (provider && provider.models[specified.modelID]) return specified
  }

  if (specified && !providers.length) return specified

  const axcodeProvider = providers.find((p) => p.id === "ax-code")
  if (axcodeProvider) {
    if (axcodeProvider.models["big-pickle"]) {
      return { providerID: ProviderID.axCode, modelID: ModelID.make("big-pickle") }
    }
    const [best] = Provider.sort(Object.values(axcodeProvider.models))
    if (best) {
      return {
        providerID: ProviderID.make(best.providerID),
        modelID: ModelID.make(best.id),
      }
    }
  }

  const models = providers.flatMap((p) => Object.values(p.models))
  const [best] = Provider.sort(models)
  if (best) {
    return {
      providerID: ProviderID.make(best.providerID),
      modelID: ModelID.make(best.id),
    }
  }

  if (specified) return specified

  return { providerID: ProviderID.axCode, modelID: ModelID.make("big-pickle") }
}

export function parseUri(uri: string): ParsedACPResource {
  try {
    if (uri.startsWith("file://")) {
      const filepath = fileURLToPath(uri)
      const name = path.basename(filepath) || filepath
      return {
        type: "file",
        url: uri,
        filename: name,
        mime: "text/plain",
      }
    }
    if (uri.startsWith("zed://")) {
      const url = new URL(uri)
      const path = url.searchParams.get("path")
      if (path) {
        const name = path.split("/").pop() || path
        return {
          type: "file",
          url: pathToFileURL(path).href,
          filename: name,
          mime: "text/plain",
        }
      }
    }
    return {
      type: "text",
      text: uri,
    }
  } catch {
    return {
      type: "text",
      text: uri,
    }
  }
}

export function getNewContent(fileOriginal: string, unifiedDiff: string): string | undefined {
  const result = applyPatch(fileOriginal, unifiedDiff)
  if (result === false) {
    log.error("Failed to apply unified diff (context mismatch)")
    return undefined
  }
  return result
}

export function sortProvidersByName<T extends { name: string }>(providers: T[]): T[] {
  return [...providers].sort((a, b) => {
    const nameA = a.name.toLowerCase()
    const nameB = b.name.toLowerCase()
    if (nameA < nameB) return -1
    if (nameA > nameB) return 1
    return 0
  })
}

export function modelVariantsFromProviders(
  providers: Array<{ id: string; models: Record<string, { variants?: Record<string, any> }> }>,
  model: { providerID: ProviderID; modelID: ModelID },
): string[] {
  const provider = providers.find((entry) => entry.id === model.providerID)
  if (!provider) return []
  const modelInfo = provider.models[model.modelID]
  if (!modelInfo?.variants) return []
  return Object.keys(modelInfo.variants)
}

export function buildAvailableModels(
  providers: Array<{ id: string; name: string; models: Record<string, any> }>,
  options: { includeVariants?: boolean } = {},
): ModelOption[] {
  const includeVariants = options.includeVariants ?? false
  return providers.flatMap((provider) => {
    const unsorted: Array<{ id: string; name: string; variants?: Record<string, any> }> = Object.values(provider.models)
    const models = Provider.sort(unsorted)
    return models.flatMap((model) => {
      const modelId = providerModelKey({ providerID: provider.id, modelID: model.id })
      const base: ModelOption = {
        modelId,
        name: `${provider.name}/${model.name}`,
      }
      if (!includeVariants || !model.variants) return [base]
      const variants = Object.keys(model.variants).filter((variant) => variant !== DEFAULT_VARIANT_VALUE)
      const variantOptions = variants.map((variant) => ({
        modelId: `${modelId}/${variant}`,
        name: `${provider.name}/${model.name} (${variant})`,
      }))
      return [base, ...variantOptions]
    })
  })
}

export function formatModelIdWithVariant(
  model: { providerID: ProviderID; modelID: ModelID },
  variant: string | undefined,
  availableVariants: string[],
  includeVariant: boolean,
) {
  const base = providerModelKey(model)
  if (!includeVariant || !variant || !availableVariants.includes(variant)) return base
  return `${base}/${variant}`
}

export function buildVariantMeta(input: {
  model: { providerID: ProviderID; modelID: ModelID }
  variant?: string
  availableVariants: string[]
}) {
  return {
    "ax-code": {
      modelId: providerModelKey(input.model),
      variant: input.variant ?? null,
      availableVariants: input.availableVariants,
    },
  }
}

export function parseModelSelection(
  modelId: string,
  providers: Array<{ id: string; models: Record<string, { variants?: Record<string, any> }> }>,
): { model: { providerID: ProviderID; modelID: ModelID }; variant?: string } {
  const parsed = Provider.parseModel(modelId)
  const provider = providers.find((p) => p.id === parsed.providerID)
  if (!provider) {
    return { model: parsed, variant: undefined }
  }

  if (provider.models[parsed.modelID]) {
    return { model: parsed, variant: undefined }
  }

  const segments = parsed.modelID.split("/")
  if (segments.length > 1) {
    const candidateVariant = segments[segments.length - 1]
    const baseModelId = segments.slice(0, -1).join("/")
    const baseModelInfo = provider.models[baseModelId]
    if (baseModelInfo?.variants && candidateVariant in baseModelInfo.variants) {
      return {
        model: { providerID: parsed.providerID, modelID: ModelID.make(baseModelId) },
        variant: candidateVariant,
      }
    }
  }

  return { model: parsed, variant: undefined }
}
