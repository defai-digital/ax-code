import type { Provider } from "../provider"
import type { CustomLoader } from "../loaders"
import { ProviderID, ModelID } from "../schema"
import {
  AX_ENGINE_DEFAULT_MAX_OUTPUT_TOKENS,
  AX_ENGINE_DEFAULT_PORT,
  AX_ENGINE_ERROR,
  AX_ENGINE_MODEL_DEFINITIONS,
  AX_ENGINE_MODEL_IDS,
  AX_ENGINE_PROVIDER_ID,
  isAxEngineBuiltinModelID,
  resolveAxEngineApiKey,
  resolveAxEngineMaxConcurrentRequests,
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
import { resolveAxEngineAttachBaseURL, resolveAxEngineConnectMode } from "./connection"
import {
  fetchAxEngineModelContracts,
  requireAxEngineCodingContract,
  type AxEngineLiveModelContract,
} from "./model-card"
import { axEngineHubCatalog, resolveAxEngineModelDefinition } from "./hub-catalog"
import type { AxEngineModelDefinition } from "./constants"
import { axEngineLocalRepository, requireAxEngineLocalModel, selectAxEngineLocalModels } from "./local-models"

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
// ensureServer may bind a fallback port (31419+) when the preferred one is
// held by a foreign process — the server's real address lives in its state,
// not in the SDK. Track only the managed server this process last verified
// or started and rewrite managed requests to it at fetch time, so a port
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

function assertAxEngineRequestTarget(input: string | URL | Request, endpoint: string) {
  const target = new URL(input instanceof Request ? input.url : input.toString())
  const allowed = new URL(endpoint)
  const basePath = allowed.pathname.replace(/\/+$/, "")
  const insidePath = target.pathname === basePath || target.pathname.startsWith(`${basePath}/`)
  if (target.origin !== allowed.origin || target.username || target.password || !insidePath) {
    throw new Error("AX Engine request escaped its configured endpoint")
  }
}

function configuredBaseURL(provider: Provider.Info) {
  if (resolveAxEngineConnectMode(provider.options) !== "attach") return
  return resolveAxEngineAttachBaseURL(provider.options)
}

function inputLimit(context: number, output: number) {
  return Math.max(1, context - Math.min(context, output))
}

function applyLiveContract(model: Provider.Model, contract: AxEngineLiveModelContract) {
  const context = contract.context ?? model.limit.context
  const output = Math.min(context, contract.output ?? model.limit.output)
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

async function ensureManagedReady(provider: Provider.Info, options: AxEngineModelOptions = {}, signal?: AbortSignal) {
  const modelID = normalizeModelID(options.modelID)
  requireAxEngineLocalModel(modelID)
  const quantization = normalizeQuantization(options.quantization, modelID)
  const definition = await resolveAxEngineModelDefinition(modelID, { signal })
  const apiModelID = definition.apiModelID

  const eligibility = await requirePlatformEligibility()
  if (
    definition.estimatedResources &&
    (eligibility.memoryBytes === undefined || eligibility.memoryBytes < definition.minMemoryBytes)
  ) {
    throw new Error(
      `${AX_ENGINE_ERROR.InsufficientMemory}: this package needs an estimated ${Math.ceil(definition.minMemoryBytes / 1024 ** 3)} GiB unified memory`,
    )
  }

  const dependency = await getDependencyStatus(provider.options)
  if (!dependency.available || !dependency.binaryPath) {
    throw new Error(dependency.blockers[0] ?? "ax-engine binary is not available")
  }

  const model = await getModelStatus({ ...provider.options, ...options, modelID, quantization })
  if (!model.present || !model.path) {
    const requiredBytes = await requiredDiskBytes(modelID, quantization)
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
    contextTokens: definition.contextTokens,
    maxOutputTokens: definition.outputTokens,
    binaryVersion: dependency.version,
    maxConcurrentRequests: resolveAxEngineMaxConcurrentRequests(provider.options),
    apiKey: resolveAxEngineApiKey(provider.options, provider.key),
    signal,
  })
  noteActiveAxEngineServer(state.baseURL)
  const contracts = await fetchAxEngineModelContracts({
    baseURL: state.baseURL,
    apiKey: resolveAxEngineApiKey(provider.options, provider.key),
    signal,
  })
  return requireAxEngineCodingContract(contracts, apiModelID, { requireText: Boolean(definition.revision) })
}

export function axEngineLoader(): CustomLoader {
  return async (provider) => {
    reclaimManagedCopiesOnce()
    let runtimeProvider = provider
    // Capture whether the endpoint was explicitly configured before returning
    // loader defaults. Provider initialization merges return.options back into
    // the runtime provider; if the managed default is returned as `baseURL`, a
    // later discovery/getModel pass cannot distinguish it from a user-owned
    // external server and skips ensureManagedReady entirely.
    const configuredExternalBaseURL = configuredBaseURL(provider)
    const baseURL = configuredExternalBaseURL ?? `http://127.0.0.1:${AX_ENGINE_DEFAULT_PORT}/v1`
    const configuredApiKey =
      (typeof provider.options?.apiKey === "string" && provider.options.apiKey.trim()) ||
      process.env.AX_ENGINE_API_KEY?.trim() ||
      undefined
    const modelRefs = new Map<string, Provider.Model>()

    function remember(model: Provider.Model) {
      modelRefs.set(model.api.id, model)
      return model
    }

    function modelFromDefinition(
      def: AxEngineModelDefinition,
      live?: AxEngineLiveModelContract,
      modelBaseURL = baseURL,
    ) {
      const modelID = def.id
      const id = ModelID.make(modelID)
      const model: Provider.Model = {
        id,
        providerID: ProviderID.make(AX_ENGINE_PROVIDER_ID),
        name: def.name,
        family: modelID,
        api: { id: def.apiModelID, url: modelBaseURL, npm: "@ai-sdk/openai-compatible" },
        capabilities: {
          temperature: true,
          reasoning: def.reasoning,
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
          minMemoryBytes: def.minMemoryBytes,
          ...(def.revision ? { axEngineCandidate: true, revision: def.revision } : {}),
        },
        headers: {},
        release_date: def.releaseDate,
        variants: {},
      }
      if (live) applyLiveContract(model, live)
      return remember(model)
    }

    function modelFromExternalContract(contract: AxEngineLiveModelContract, modelBaseURL: string) {
      const definitionID = AX_ENGINE_MODEL_IDS.find(
        (candidate) => AX_ENGINE_MODEL_DEFINITIONS[candidate].apiModelID === contract.id,
      )
      if (definitionID) return modelFromDefinition(AX_ENGINE_MODEL_DEFINITIONS[definitionID], contract, modelBaseURL)
      const context = contract.context ?? 16_384
      const output = Math.min(context, contract.output ?? AX_ENGINE_DEFAULT_MAX_OUTPUT_TOKENS)
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
        // For managed mode model.api.url supplies the SDK endpoint. Only
        // persist baseURL as a provider option when the user explicitly chose
        // an external server.
        ...(configuredExternalBaseURL ? { baseURL: configuredExternalBaseURL } : {}),
        // Auth-store credentials are merged into provider.key after the custom
        // loader runs. Only return config/env credentials here so encrypted
        // auth can win without being shadowed by the default "local" key.
        ...(configuredApiKey ? { apiKey: configuredApiKey } : {}),
        // AX Engine 6.11+ emits the OpenAI-compatible terminal usage chunk
        // when stream_options.include_usage is requested. Keeping this off
        // made every successful local turn look like a zero-token response,
        // which broke context telemetry and usage-driven compaction.
        includeUsage: true,
        fetch: async (input: string | Request | URL, init?: RequestInit) => {
          const target = configuredExternalBaseURL ? input : rewriteToActiveAxEngineServer(input, baseURL)
          assertAxEngineRequestTarget(target, configuredExternalBaseURL ?? activeServerBaseURL ?? baseURL)
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
          if (!headers.has("authorization")) {
            headers.set(
              "authorization",
              `Bearer ${resolveAxEngineApiKey(runtimeProvider.options, runtimeProvider.key)}`,
            )
          }
          // Attached endpoints belong to this provider instance. A managed
          // fallback port (or another attached provider) must never redirect
          // their prompts or credentials. Keep redirects inside the same
          // trust boundary as the model discovery probe.
          return fetch(target, { ...init, headers, redirect: "error" })
        },
      },
      async discoverModels(currentProvider) {
        if (currentProvider?.options) runtimeProvider = currentProvider
        const models: Record<string, Provider.Model> = {}
        const externalBaseURL = configuredExternalBaseURL
        if (externalBaseURL) {
          const contracts = await fetchAxEngineModelContracts({
            baseURL: externalBaseURL,
            apiKey: resolveAxEngineApiKey(runtimeProvider.options, runtimeProvider.key),
            signal: AbortSignal.timeout(2_000),
          })
          for (const contract of contracts) {
            const model = modelFromExternalContract(contract, externalBaseURL)
            models[model.id] = model
          }
          return models
        }

        const definitions = selectAxEngineLocalModels(
          [
            ...AX_ENGINE_MODEL_IDS.map((id) => AX_ENGINE_MODEL_DEFINITIONS[id]),
            ...(await axEngineHubCatalog.inspect()).definitions,
          ],
          (model) => model.id,
        )
        for (const definition of definitions) {
          const model = modelFromDefinition(definition)
          models[model.id] = model
        }
        return models
      },
      async getModel(sdk: any, modelID: string, options?: Record<string, any>, context?: { signal?: AbortSignal }) {
        const externalBaseURL = configuredExternalBaseURL
        if (externalBaseURL) {
          const requestedModelID =
            typeof options?.apiModelID === "string" && options.apiModelID.trim()
              ? options.apiModelID.trim()
              : typeof options?.modelID === "string" && options.modelID.trim()
                ? options.modelID.trim()
                : modelID
          const apiModelID = isAxEngineBuiltinModelID(requestedModelID)
            ? AX_ENGINE_MODEL_DEFINITIONS[requestedModelID].apiModelID
            : requestedModelID
          const contracts = await fetchAxEngineModelContracts({
            baseURL: externalBaseURL,
            apiKey: resolveAxEngineApiKey(runtimeProvider.options, runtimeProvider.key),
            signal: context?.signal,
          })
          const contract = requireAxEngineCodingContract(contracts, apiModelID)
          const ref = modelRefs.get(apiModelID)
          if (ref) applyLiveContract(ref, contract)
          return sdk.languageModel(apiModelID)
        }

        requireAxEngineLocalModel(modelID)
        const selectedOptions = {
          ...options,
          modelID: normalizeModelID(options?.modelID ?? modelID),
        }
        if (axEngineLocalRepository(selectedOptions.modelID) !== axEngineLocalRepository(modelID)) {
          throw new Error(
            `${AX_ENGINE_ERROR.ModelUnsupported}: configured model target differs from the selected model`,
          )
        }
        const contract = await ensureManagedReady(runtimeProvider, selectedOptions, context?.signal)
        const apiModelID = contract.id
        const ref = modelRefs.get(apiModelID)
        if (ref) applyLiveContract(ref, contract)
        return sdk.languageModel(apiModelID)
      },
    }
  }
}
