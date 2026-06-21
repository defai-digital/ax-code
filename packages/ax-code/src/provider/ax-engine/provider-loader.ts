import type { Provider } from "../provider"
import type { CustomLoader } from "../loaders"
import { ProviderID, ModelID } from "../schema"
import {
  AX_ENGINE_API_KEY,
  AX_ENGINE_DEFAULT_PORT,
  AX_ENGINE_ERROR,
  AX_ENGINE_MODEL_DEFINITIONS,
  AX_ENGINE_MODEL_IDS,
  AX_ENGINE_PROVIDER_ID,
} from "./constants"
import { requirePlatformEligibility } from "./platform"
import { getDependencyStatus } from "./dependency"
import {
  getModelStatus,
  normalizeModelID,
  normalizeQuantization,
  requiredDiskBytes,
  type AxEngineModelOptions,
} from "./model-cache"
import { ensureServer } from "./server"
import { isLocalHostname } from "@/util/local-host"

function configuredBaseURL(provider: Provider.Info) {
  const baseURL = provider.options?.baseURL
  const raw = typeof baseURL === "string" && baseURL.trim() ? baseURL.trim() : process.env.AX_ENGINE_HOST
  if (!raw) return
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  const url = new URL(withProtocol)
  if (!isLocalHostname(url.hostname)) throw new Error("ax-engine baseURL must point to a local host")
  const normalized = withProtocol.replace(/\/+$/, "")
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`
}

async function serverAdvertisesModel(baseURL: string, apiModelID: string, signal?: AbortSignal) {
  try {
    const response = await fetch(`${baseURL.replace(/\/+$/, "")}/models`, {
      signal: signal ?? AbortSignal.timeout(2000),
      headers: { authorization: `Bearer ${AX_ENGINE_API_KEY}` },
    })
    if (!response.ok) {
      response.body?.cancel()
      return false
    }
    const data = (await response.json()) as { data?: Array<{ id?: unknown }> }
    return data.data?.some((model) => model.id === apiModelID) ?? false
  } catch {
    return false
  }
}

async function ensureReady(provider: Provider.Info, options: AxEngineModelOptions = {}, signal?: AbortSignal) {
  const modelID = normalizeModelID(options.modelID)
  const quantization = normalizeQuantization(options.quantization, modelID)
  const apiModelID = AX_ENGINE_MODEL_DEFINITIONS[modelID].apiModelID
  const baseURL = configuredBaseURL(provider)
  if (baseURL) {
    if (await serverAdvertisesModel(baseURL, apiModelID, signal)) return
    throw new Error(`ax-engine server at ${baseURL} does not advertise model ${apiModelID}`)
  }

  await requirePlatformEligibility()

  const dependency = await getDependencyStatus(provider.options)
  if (!dependency.available || !dependency.binaryPath) {
    throw new Error(dependency.blockers[0] ?? "ax-engine binary is not available")
  }

  const model = await getModelStatus({ ...provider.options, ...options, modelID, quantization })
  if (!model.present || !model.path) {
    const definition = AX_ENGINE_MODEL_DEFINITIONS[modelID]
    const requiredBytes = requiredDiskBytes(modelID, quantization)
    const requiredGiB = Math.ceil(requiredBytes / 1024 ** 3)
    throw new Error(
      [
        `${AX_ENGINE_ERROR.ModelNotPrepared}: ${definition.name} is not downloaded`,
        `Required disk space: ~${requiredGiB} GiB for ${quantization}`,
        `Download via: ax-code providers ax-engine prepare --model ${modelID} --quantization ${quantization} --download`,
      ].join("\n"),
    )
  }
  await ensureServer({
    binaryPath: dependency.binaryPath,
    modelID,
    apiModelID: AX_ENGINE_MODEL_DEFINITIONS[modelID].apiModelID,
    modelPath: model.path,
    modelRevision: model.revision,
    preferredPort: AX_ENGINE_DEFAULT_PORT,
    contextTokens: AX_ENGINE_MODEL_DEFINITIONS[modelID].contextTokens,
    baseURL,
    signal,
  })
}

export function axEngineLoader(): CustomLoader {
  return async (provider) => {
    const baseURL = configuredBaseURL(provider) ?? `http://127.0.0.1:${AX_ENGINE_DEFAULT_PORT}/v1`
    return {
      autoload: false,
      options: {
        baseURL,
        apiKey: AX_ENGINE_API_KEY,
        includeUsage: false,
        fetch: async (input: string | Request | URL, init?: RequestInit) => {
          return fetch(input, init)
        },
      },
      async discoverModels() {
        const models: Record<string, Provider.Model> = {}
        for (const modelID of AX_ENGINE_MODEL_IDS) {
          const def = AX_ENGINE_MODEL_DEFINITIONS[modelID]
          const id = ModelID.make(modelID)
          models[id] = {
            id,
            providerID: ProviderID.make(AX_ENGINE_PROVIDER_ID),
            name: def.name,
            api: { id: def.apiModelID, url: baseURL, npm: "@ai-sdk/openai-compatible" },
            capabilities: {
              temperature: true,
              reasoning: false,
              attachment: false,
              toolcall: def.toolcall,
              input: { text: true, audio: false, image: false, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            limit: { context: def.contextTokens, output: def.outputTokens },
            status: "active",
            options: {
              modelID,
              quantization: def.defaultQuantization,
            },
            headers: {},
            release_date: "",
            variants: {},
          }
        }
        return models
      },
      async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
        const selectedOptions = {
          ...options,
          modelID: normalizeModelID(options?.modelID ?? modelID),
        }
        await ensureReady(provider, selectedOptions)
        return sdk.languageModel(AX_ENGINE_MODEL_DEFINITIONS[selectedOptions.modelID].apiModelID)
      },
    }
  }
}
