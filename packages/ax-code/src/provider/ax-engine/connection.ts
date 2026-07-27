import { isLocalHostname } from "@/util/local-host"
import { AX_ENGINE_API_KEY, AX_ENGINE_DEFAULT_PORT, AX_ENGINE_ERROR, resolveAxEngineApiKey } from "./constants"
import { fetchAxEngineModelContracts, type AxEngineLiveModelContract } from "./model-card"

export const AX_ENGINE_CONNECTION_MODES = ["managed", "attach"] as const
export type AxEngineConnectMode = (typeof AX_ENGINE_CONNECTION_MODES)[number]

export type AxEngineConnectionOptions = {
  connectionMode?: unknown
  baseURL?: unknown
  apiKey?: unknown
  [key: string]: unknown
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

/**
 * Normalize an AX Engine OpenAI-compatible endpoint and keep attach mode on the
 * local machine. Remote/LAN attachment can be added later with an explicit TLS
 * and trust policy instead of silently sending bearer credentials over a LAN.
 */
export function normalizeAxEngineEndpointBaseURL(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error("Endpoint URL is required")
  if (trimmed.length > 2_048) throw new Error("ax-engine endpoint is too long")
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  const url = new URL(withProtocol)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("ax-engine endpoint must use http:// or https://")
  }
  if (url.username || url.password) {
    throw new Error("ax-engine endpoint must not include embedded credentials")
  }
  if (url.search || url.hash) {
    throw new Error("ax-engine endpoint must not include a query string or fragment")
  }
  if (!isLocalHostname(url.hostname) || url.hostname === "0.0.0.0") {
    throw new Error("ax-engine endpoint must point to a local host (localhost / 127.0.0.0/8)")
  }
  const normalized = `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "")
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`
}

/**
 * Explicit connectionMode wins over legacy URL/env inference. This lets a user
 * switch back to managed mode even when AX_ENGINE_HOST remains set.
 */
export function resolveAxEngineConnectMode(options: AxEngineConnectionOptions = {}): AxEngineConnectMode {
  if (options.connectionMode === "managed" || options.connectionMode === "attach") {
    return options.connectionMode
  }
  if (optionalString(options.baseURL) || optionalString(process.env.AX_ENGINE_HOST)) return "attach"
  return "managed"
}

export function resolveAxEngineAttachBaseURL(options: AxEngineConnectionOptions = {}): string {
  const raw =
    optionalString(options.baseURL) ??
    optionalString(process.env.AX_ENGINE_HOST) ??
    `http://127.0.0.1:${AX_ENGINE_DEFAULT_PORT}`
  return normalizeAxEngineEndpointBaseURL(raw)
}

function comparableAxEngineHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "127.0.0.1"
  ) {
    return "default-loopback"
  }
  return normalized
}

/** Conservatively detect aliases for the same local listener. */
export function axEngineEndpointsMayAlias(left: string, right: string) {
  const first = new URL(normalizeAxEngineEndpointBaseURL(left))
  const second = new URL(normalizeAxEngineEndpointBaseURL(right))
  return (
    first.protocol === second.protocol &&
    first.port === second.port &&
    first.pathname === second.pathname &&
    comparableAxEngineHostname(first.hostname) === comparableAxEngineHostname(second.hostname)
  )
}

export function axEngineManagedProviderConfig(providerName: string) {
  return {
    "ax-engine": {
      name: providerName,
      options: {
        connectionMode: "managed" as const,
        // Empty strings overwrite legacy attach values under mergeDeep without
        // leaving the endpoint or credential in plaintext project config.
        baseURL: "",
        apiKey: "",
      },
    },
  }
}

export function axEngineAttachProviderConfig(input: { providerName: string; baseURL: string }) {
  return {
    "ax-engine": {
      name: input.providerName,
      options: {
        connectionMode: "attach" as const,
        baseURL: normalizeAxEngineEndpointBaseURL(input.baseURL),
        // Credentials belong in encrypted auth.json, not project config.
        apiKey: "",
      },
    },
  }
}

export type AxEngineConnectionProbe = {
  baseURL: string
  models: AxEngineLiveModelContract[]
  toolcall: boolean
}

export async function probeAxEngineConnection(input: {
  baseURL: string
  apiKey?: string
  signal?: AbortSignal
}): Promise<AxEngineConnectionProbe> {
  const baseURL = normalizeAxEngineEndpointBaseURL(input.baseURL)
  const models = await fetchAxEngineModelContracts({
    baseURL,
    apiKey: input.apiKey ?? resolveAxEngineApiKey(),
    signal: input.signal ?? AbortSignal.timeout(5_000),
  })
  if (!models.some((model) => model.toolcall)) {
    throw new Error(
      `${AX_ENGINE_ERROR.ToolcallUnsupported}: attached ax-engine server has no model with OpenAI structured tool calling`,
    )
  }
  return {
    baseURL,
    models,
    toolcall: true,
  }
}

export function axEngineConnectionApiKey(input: {
  requested?: string
  saved?: string
  options?: AxEngineConnectionOptions
}) {
  const apiKey =
    optionalString(input.requested) ??
    optionalString(input.saved) ??
    resolveAxEngineApiKey(input.options ?? {}) ??
    AX_ENGINE_API_KEY
  if (apiKey.includes("\0") || Buffer.byteLength(apiKey, "utf8") > 16_384) {
    throw new Error("ax-engine API key is invalid or too large")
  }
  return apiKey
}
