import type { Provider } from "../provider"
import type { CustomLoader } from "../loaders"
import { ProviderID, ModelID } from "../schema"
import {
  AX_ENGINE_API_KEY,
  AX_ENGINE_CONTEXT_TOKENS,
  AX_ENGINE_DEFAULT_PORT,
  AX_ENGINE_MODEL_DEFINITIONS,
  AX_ENGINE_MODEL_IDS,
  AX_ENGINE_OUTPUT_TOKENS,
  AX_ENGINE_PROVIDER_ID,
} from "./constants"
import { requirePlatformEligibility } from "./platform"
import { getDependencyStatus } from "./dependency"
import {
  downloadModel,
  getModelStatus,
  normalizeModelID,
  normalizeQuantization,
  type AxEngineModelOptions,
} from "./model-cache"
import { ensureServer, isServerReady } from "./server"
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
    if (!response.ok) return false
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
  let modelPath = model.path
  let modelRevision = model.revision
  if (!model.present || !modelPath) {
    // Download on first use so connecting and picking a model "just works" like
    // the other providers, instead of forcing the user to run a CLI prepare step.
    const prepared = await downloadModel({
      binaryPath: dependency.binaryPath,
      modelID,
      quantization,
      signal,
    })
    modelPath = prepared.path
    modelRevision = prepared.revision
  }
  await ensureServer({
    binaryPath: dependency.binaryPath,
    modelID,
    apiModelID: AX_ENGINE_MODEL_DEFINITIONS[modelID].apiModelID,
    modelPath,
    modelRevision,
    preferredPort: AX_ENGINE_DEFAULT_PORT,
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
            limit: { context: AX_ENGINE_CONTEXT_TOKENS, output: AX_ENGINE_OUTPUT_TOKENS },
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
        return sdk.languageModel(AX_ENGINE_MODEL_DEFINITIONS[normalizeModelID(selectedOptions.modelID)].apiModelID)
      },
    }
  }
}
