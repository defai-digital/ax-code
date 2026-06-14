import type { Provider } from "../provider"
import type { CustomLoader } from "../loaders"
import { AX_ENGINE_API_KEY, AX_ENGINE_DEFAULT_PORT, AX_ENGINE_MODEL_ID } from "./constants"
import { isSupportedHost, requirePlatformEligibility } from "./platform"
import { getDependencyStatus } from "./dependency"
import { getModelStatus } from "./model-cache"
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

async function ensureReady(provider: Provider.Info, signal?: AbortSignal) {
  const baseURL = configuredBaseURL(provider)
  if (baseURL && (await isServerReady(baseURL, signal))) return

  await requirePlatformEligibility()

  const model = await getModelStatus(provider.options)
  if (!model.present || !model.path) {
    throw new Error(model.blockers[0] ?? "ax-engine model is not prepared")
  }
  const dependency = await getDependencyStatus(provider.options)
  if (!dependency.available || !dependency.binaryPath) {
    throw new Error(dependency.blockers[0] ?? "ax-engine binary is not available")
  }
  await ensureServer({
    binaryPath: dependency.binaryPath,
    modelPath: model.path,
    modelRevision: model.revision,
    preferredPort: AX_ENGINE_DEFAULT_PORT,
    baseURL,
    signal,
  })
}

export function axEngineLoader(): CustomLoader {
  return async (provider) => {
    const baseURL = configuredBaseURL(provider) ?? `http://127.0.0.1:${AX_ENGINE_DEFAULT_PORT}/v1`
    const autoload = await isSupportedHost()
    return {
      autoload,
      options: {
        baseURL,
        apiKey: AX_ENGINE_API_KEY,
        includeUsage: false,
        fetch: async (input: string | Request | URL, init?: RequestInit) => {
          await ensureReady(provider, init?.signal ?? undefined)
          return fetch(input, init)
        },
      },
      async discoverModels() {
        return {}
      },
      async getModel(sdk: any, modelID: string) {
        return sdk.languageModel(modelID || AX_ENGINE_MODEL_ID)
      },
    }
  }
}
