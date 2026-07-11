import type { Provider } from "../provider"
import type { CustomLoader } from "../loaders"
import { ProviderID, ModelID } from "../schema"
import {
  AX_ENGINE_DEFAULT_PORT,
  AX_ENGINE_ERROR,
  AX_ENGINE_MODEL_DEFINITIONS,
  AX_ENGINE_MODEL_IDS,
  AX_ENGINE_PROVIDER_ID,
  isAxEngineModelID,
  resolveAxEngineApiKey,
} from "./constants"
import { requirePlatformEligibility } from "./platform"
import { getDependencyStatus } from "./dependency"
import {
  getModelStatus,
  normalizeModelID,
  normalizeQuantization,
  reclaimManagedModelCopies,
  requiredDiskBytes,
  type AxEngineModelOptions,
} from "./model-cache"
import { ensureServer } from "./server"
import { isLocalHostname } from "@/util/local-host"
import { fetchAxEngineModelContracts, type AxEngineLiveModelContract } from "./model-card"

// Reclaim legacy managed copies once per process. The loader runs whenever the
// provider list is resolved; the guard keeps the (potentially large) directory
// scan and delete off the hot path after the first call.
let reclaimStarted = false
function reclaimManagedCopiesOnce() {
  if (reclaimStarted) return
  reclaimStarted = true
  void reclaimManagedModelCopies().catch(() => undefined)
}

// The OpenAI-compatible SDK is constructed once against the default port, but
// ensureServer may bind a fallback port (18182+) when the preferred one is
// held by a foreign process — the server's real address lives in its state,
// not in the SDK. Track the base URL of the server this process last verified
// or started and rewrite outgoing requests to it at fetch time, so a port
// fallback (or a respawn on a new port) still reaches the managed server even
// through cached SDK/language-model instances.
let activeServerBaseURL: string | undefined

export function noteActiveAxEngineServer(baseURL: string | undefined) {
  activeServerBaseURL = baseURL
}

export function rewriteToActiveAxEngineServer(
  input: string | URL | Request,
  assumedBaseURL: string,
): string | URL | Request {
  const active = activeServerBaseURL
  if (!active || active === assumedBaseURL) return input
  const url = input instanceof Request ? input.url : input.toString()
  if (url !== assumedBaseURL && !url.startsWith(`${assumedBaseURL}/`)) return input
  const rewritten = `${active}${url.slice(assumedBaseURL.length)}`
  return input instanceof Request ? new Request(rewritten, input) : rewritten
}

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

function inputLimit(context: number, output: number) {
  return Math.max(1, context - Math.min(context, output))
}

function applyLiveContract(model: Provider.Model, contract: AxEngineLiveModelContract) {
  const context = contract.context ?? model.limit.context
  const output = contract.output ?? model.limit.output
  model.limit = {
    context,
    output,
    input: inputLimit(context, output),
  }
  model.capabilities = {
    ...model.capabilities,
    temperature: contract.capabilities.temperature ?? model.capabilities.temperature,
    reasoning: contract.capabilities.reasoning ?? model.capabilities.reasoning,
    toolcall: contract.toolcall,
    attachment: contract.attachment,
    input: contract.capabilities.input ?? model.capabilities.input,
    output: contract.capabilities.output ?? model.capabilities.output,
    interleaved: contract.capabilities.interleaved ?? model.capabilities.interleaved,
  }
  model.options = {
    ...model.options,
    apiModelID: contract.id,
    livePrimaryUse: contract.primaryUse,
    liveChatDefault: contract.chatDefault,
    liveCodingSupported: contract.codingSupported,
    liveCodingOnly: contract.codingOnly,
  }
}

function requireCodingContract(contracts: AxEngineLiveModelContract[], apiModelID: string) {
  const contract = contracts.find((item) => item.id === apiModelID)
  if (!contract) throw new Error(`ax-engine server does not advertise model ${apiModelID}`)
  // AX Engine's coding_supported flag is advisory and currently true only for
  // its Qwen chat template. Gemma and GLM can still be valid coding agents when
  // the live card advertises structured OpenAI tool calling, which is the
  // compatibility contract AX Code actually requires.
  if (!contract.toolcall) {
    throw new Error(
      `${AX_ENGINE_ERROR.ToolcallUnsupported}: ax-engine model ${apiModelID} does not advertise OpenAI structured tool calling`,
    )
  }
  return contract
}

async function ensureManagedReady(provider: Provider.Info, options: AxEngineModelOptions = {}, signal?: AbortSignal) {
  const modelID = normalizeModelID(options.modelID)
  const quantization = normalizeQuantization(options.quantization, modelID)
  const apiModelID = AX_ENGINE_MODEL_DEFINITIONS[modelID].apiModelID

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
  const state = await ensureServer({
    binaryPath: dependency.binaryPath,
    modelID,
    apiModelID,
    modelPath: model.path,
    modelRevision: model.revision,
    preferredPort: AX_ENGINE_DEFAULT_PORT,
    contextTokens: AX_ENGINE_MODEL_DEFINITIONS[modelID].contextTokens,
    apiKey: resolveAxEngineApiKey(provider.options),
    signal,
  })
  noteActiveAxEngineServer(state.baseURL)
  const contracts = await fetchAxEngineModelContracts({
    baseURL: state.baseURL,
    apiKey: resolveAxEngineApiKey(provider.options),
    signal,
  })
  return requireCodingContract(contracts, apiModelID)
}

export function axEngineLoader(): CustomLoader {
  return async (provider) => {
    reclaimManagedCopiesOnce()
    let runtimeProvider = provider
    const baseURL = configuredBaseURL(provider) ?? `http://127.0.0.1:${AX_ENGINE_DEFAULT_PORT}/v1`
    const apiKey = resolveAxEngineApiKey(provider.options)
    const modelRefs = new Map<string, Provider.Model>()

    function remember(model: Provider.Model) {
      modelRefs.set(model.api.id, model)
      return model
    }

    function modelFromDefinition(
      modelID: (typeof AX_ENGINE_MODEL_IDS)[number],
      live?: AxEngineLiveModelContract,
      modelBaseURL = baseURL,
    ) {
      const def = AX_ENGINE_MODEL_DEFINITIONS[modelID]
      const id = ModelID.make(modelID)
      const model: Provider.Model = {
        id,
        providerID: ProviderID.make(AX_ENGINE_PROVIDER_ID),
        name: def.name,
        family: modelID,
        api: { id: def.apiModelID, url: modelBaseURL, npm: "@ai-sdk/openai-compatible" },
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: false,
          toolcall: def.toolcall,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        limit: {
          context: def.contextTokens,
          input: inputLimit(def.contextTokens, def.outputTokens),
          output: def.outputTokens,
        },
        status: "active",
        options: {
          modelID,
          apiModelID: def.apiModelID,
          quantization: def.defaultQuantization,
        },
        headers: {},
        release_date: "",
        variants: {},
      }
      if (live) applyLiveContract(model, live)
      return remember(model)
    }

    function modelFromExternalContract(contract: AxEngineLiveModelContract, modelBaseURL: string) {
      const definitionID = AX_ENGINE_MODEL_IDS.find(
        (candidate) => AX_ENGINE_MODEL_DEFINITIONS[candidate].apiModelID === contract.id,
      )
      if (definitionID) return modelFromDefinition(definitionID, contract, modelBaseURL)
      const context = contract.context ?? 16_384
      const output = contract.output ?? 2_048
      return remember({
        id: ModelID.make(contract.id),
        providerID: ProviderID.make(AX_ENGINE_PROVIDER_ID),
        name: contract.id,
        family: contract.id,
        api: { id: contract.id, url: modelBaseURL, npm: "@ai-sdk/openai-compatible" },
        capabilities: {
          temperature: contract.capabilities.temperature ?? true,
          reasoning: contract.capabilities.reasoning ?? false,
          attachment: contract.attachment,
          toolcall: contract.toolcall,
          input: contract.capabilities.input ?? {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          output: contract.capabilities.output ?? {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          interleaved: contract.capabilities.interleaved ?? false,
        },
        limit: { context, input: inputLimit(context, output), output },
        status: "active",
        options: {
          apiModelID: contract.id,
          external: true,
          livePrimaryUse: contract.primaryUse,
          liveChatDefault: contract.chatDefault,
          liveCodingSupported: contract.codingSupported,
          liveCodingOnly: contract.codingOnly,
        },
        headers: {},
        release_date: "",
        variants: {},
      })
    }

    return {
      autoload: false,
      options: {
        baseURL,
        apiKey,
        includeUsage: false,
        fetch: async (input: string | Request | URL, init?: RequestInit) => {
          return fetch(rewriteToActiveAxEngineServer(input, baseURL), init)
        },
      },
      async discoverModels(currentProvider) {
        if (currentProvider?.options) runtimeProvider = currentProvider
        const models: Record<string, Provider.Model> = {}
        const externalBaseURL = configuredBaseURL(runtimeProvider)
        if (externalBaseURL) {
          const contracts = await fetchAxEngineModelContracts({
            baseURL: externalBaseURL,
            apiKey: resolveAxEngineApiKey(runtimeProvider.options),
            signal: AbortSignal.timeout(2_000),
          }).catch(() => [])
          if (contracts.length > 0) {
            for (const contract of contracts) {
              const model = modelFromExternalContract(contract, externalBaseURL)
              models[model.id] = model
            }
            return models
          }
        }

        for (const modelID of AX_ENGINE_MODEL_IDS) {
          const model = modelFromDefinition(modelID)
          models[model.id] = model
        }
        return models
      },
      async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
        const externalBaseURL = configuredBaseURL(runtimeProvider)
        if (externalBaseURL) {
          const requestedModelID =
            typeof options?.apiModelID === "string" && options.apiModelID.trim()
              ? options.apiModelID.trim()
              : typeof options?.modelID === "string" && options.modelID.trim()
                ? options.modelID.trim()
                : modelID
          const apiModelID = isAxEngineModelID(requestedModelID)
            ? AX_ENGINE_MODEL_DEFINITIONS[requestedModelID].apiModelID
            : requestedModelID
          const contracts = await fetchAxEngineModelContracts({
            baseURL: externalBaseURL,
            apiKey: resolveAxEngineApiKey(runtimeProvider.options),
            signal: undefined,
          })
          const contract = requireCodingContract(contracts, apiModelID)
          const ref = modelRefs.get(apiModelID)
          if (ref) applyLiveContract(ref, contract)
          noteActiveAxEngineServer(externalBaseURL)
          return sdk.languageModel(apiModelID)
        }

        const selectedOptions = {
          ...options,
          modelID: normalizeModelID(options?.modelID ?? modelID),
        }
        const contract = await ensureManagedReady(runtimeProvider, selectedOptions)
        const apiModelID = AX_ENGINE_MODEL_DEFINITIONS[selectedOptions.modelID].apiModelID
        const ref = modelRefs.get(apiModelID)
        if (ref) applyLiveContract(ref, contract)
        return sdk.languageModel(apiModelID)
      },
    }
  }
}
