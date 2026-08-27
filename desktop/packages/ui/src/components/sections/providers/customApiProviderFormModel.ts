import type {
  CustomApiProviderInput,
  CustomApiProviderModel,
  CustomApiProviderProtocol,
  CustomApiProviderView,
} from "@/lib/ax-code/providerApi"

export type CustomApiProviderModelDraft = {
  rowID: string
  id: string
  name: string
  contextWindow: string
  outputLimit: string
  toolCall: boolean
  reasoning: boolean
  attachment: boolean
  temperature: boolean
}
export type CustomApiProviderDraft = {
  providerID: string
  name: string
  protocol: CustomApiProviderProtocol
  baseURL: string
  apiToken: string
  allowInsecureHttp: boolean
  models: CustomApiProviderModelDraft[]
}

let nextRowID = 0
export function newCustomApiProviderModelDraft(model?: CustomApiProviderModel): CustomApiProviderModelDraft {
  nextRowID += 1
  return {
    rowID: `custom-provider-model-${nextRowID}`,
    id: model?.id ?? "",
    name: model?.name ?? "",
    contextWindow: model ? String(model.contextWindow) : "128000",
    outputLimit: model ? String(model.outputLimit) : "16384",
    toolCall: model?.toolCall ?? true,
    reasoning: model?.reasoning ?? false,
    attachment: model?.attachment ?? false,
    temperature: model?.temperature ?? false,
  }
}

function isLoopbackHostname(hostname: string) {
  const host = hostname.toLowerCase()
  return host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host)
}

function parseBaseURL(value: string) {
  const baseURL = value.trim()
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    throw new Error("Base URL must be a valid HTTP(S) URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Base URL must use HTTP or HTTPS")
  if (url.username || url.password) throw new Error("Base URL must not contain credentials")
  if (url.search || url.hash) throw new Error("Base URL must not contain a query string or fragment")
  if (baseURL.length > 2_048) throw new Error("Base URL cannot exceed 2,048 characters")
  return { baseURL, url }
}

export function customApiProviderNeedsInsecureHttp(value: string) {
  const { url } = parseBaseURL(value)
  return url.protocol === "http:" && !isLoopbackHostname(url.hostname)
}

/** Same endpoint regardless of trailing slashes or host casing. */
export function sameCustomApiBaseURL(left: string, right: string): boolean {
  const normalize = (value: string) => {
    try {
      const url = new URL(value.trim())
      return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`.toLowerCase()
    } catch {
      return value.trim().replace(/\/+$/, "").toLowerCase()
    }
  }
  return normalize(left) === normalize(right)
}

/**
 * The managed provider that already serves this endpoint, if any. Saving a
 * second provider for the same URL would mint a new provider ID and orphan
 * every agent pin, recent entry, and small_model that names the first.
 */
export function findCustomApiProviderByBaseURL<T extends { baseURL: string }>(
  providers: readonly T[],
  baseURL: string,
): T | undefined {
  if (!baseURL.trim()) return undefined
  return providers.find((provider) => sameCustomApiBaseURL(provider.baseURL, baseURL))
}

/** Re-run GET /models for an existing provider in place, keeping its ID and token. */
export function refreshCustomApiProviderInput(existing: CustomApiProviderView): CustomApiProviderInput {
  return {
    name: existing.name,
    protocol: existing.protocol,
    baseURL: existing.baseURL,
    allowInsecureHttp: customApiProviderNeedsInsecureHttp(existing.baseURL),
    refreshModels: true,
  }
}

export function identityFromCustomApiBaseURL(baseURL: string): { name: string; providerID: string } {
  let host = "custom-api"
  try {
    host = new URL(baseURL.trim()).hostname
  } catch {
    // Keep the fallback slug while the URL is still being typed.
  }
  const clean = host.replace(/^\[|\]$/g, "").replace(/^www\./i, "")
  const name = (clean || "Custom API").slice(0, 120)
  let providerID = clean
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
  if (!/^[a-z0-9]/.test(providerID)) providerID = `c${providerID}`.slice(0, 63)
  if (!providerID) providerID = "custom-api"
  return { name, providerID }
}

export function createCustomApiProviderDraft(existing?: CustomApiProviderView): CustomApiProviderDraft {
  return {
    providerID: existing?.providerID ?? "",
    name: existing?.name ?? "",
    protocol: existing?.protocol ?? "openai-compatible",
    baseURL: existing?.baseURL ?? "",
    apiToken: "",
    allowInsecureHttp: existing ? customApiProviderNeedsInsecureHttp(existing.baseURL) : false,
    models:
      existing && existing.models.length > 0
        ? existing.models.map((model) => newCustomApiProviderModelDraft(model))
        : [],
  }
}

function positiveSafeInteger(value: string, label: string) {
  if (!/^\d+$/.test(value.trim())) throw new Error(`${label} must be a positive integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive safe integer`)
  return parsed
}

function validateProviderID(value: string) {
  const providerID = value.trim()
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(providerID))
    throw new Error("Provider ID must be a lowercase slug with at most 63 characters")
  return providerID
}

function validateModelID(value: string) {
  const id = value.trim()
  if (!id || id.length > 256) throw new Error("Each model ID must contain 1-256 characters")
  if (/\s/u.test(id)) throw new Error(`Model ID "${id}" must not contain whitespace`)
  for (const character of id) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x1f || codePoint === 0x7f) throw new Error(`Model ID "${id}" contains a control character`)
  }
  return id
}

export function buildCustomApiProviderSubmission(draft: CustomApiProviderDraft): {
  providerID: string
  input: CustomApiProviderInput
} {
  const { baseURL } = parseBaseURL(draft.baseURL)
  const identity = identityFromCustomApiBaseURL(baseURL)
  const providerID = validateProviderID(draft.providerID.trim() || identity.providerID)
  const name = (draft.name.trim() || identity.name).slice(0, 120)
  if (!name) throw new Error("Provider name is required")
  if (customApiProviderNeedsInsecureHttp(baseURL) && !draft.allowInsecureHttp)
    throw new Error("Confirm insecure HTTP or use HTTPS")
  const apiKey = draft.apiToken
  if (apiKey.length > 16_384) throw new Error("API token cannot exceed 16,384 characters")
  const declaredModels = draft.models.filter((model) => model.id.trim())
  if (declaredModels.length > 128) throw new Error("A custom provider can declare at most 128 models")
  const seen = new Set<string>()
  const models = declaredModels.map((model) => {
    const id = validateModelID(model.id)
    if (seen.has(id)) throw new Error(`Duplicate model ID: ${id}`)
    seen.add(id)
    const modelName = model.name.trim()
    if (modelName.length > 120) throw new Error(`Display name for ${id} cannot exceed 120 characters`)
    const contextWindow = positiveSafeInteger(model.contextWindow, `Context window for ${id}`)
    const outputLimit = positiveSafeInteger(model.outputLimit, `Output limit for ${id}`)
    if (outputLimit > contextWindow) throw new Error(`Output limit for ${id} cannot exceed its context window`)
    return {
      id,
      ...(modelName ? { name: modelName } : {}),
      contextWindow,
      outputLimit,
      toolCall: model.toolCall,
      reasoning: model.reasoning,
      attachment: model.attachment,
      temperature: model.temperature,
    }
  })
  return {
    providerID,
    input: {
      name,
      protocol: draft.protocol,
      baseURL,
      allowInsecureHttp: draft.allowInsecureHttp,
      ...(apiKey.length > 0 ? { apiKey } : {}),
      ...(models.length > 0 ? { models } : {}),
    },
  }
}
