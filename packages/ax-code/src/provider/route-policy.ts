import z from "zod"
import { isKnownCliProviderID, LOCAL_RUNTIME_PROVIDER_IDS } from "@ax-code/sdk/provider-connect"
import { isLocalProviderHost } from "./local-dispatcher"

/** Discovery describes availability; only configuration authorizes recovery targets. */
export namespace RoutePolicy {
  function httpHostname(value: unknown): string | undefined {
    if (typeof value !== "string" || !value.trim()) return undefined
    try {
      const url = new URL(value)
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
      }
    } catch {
      return undefined
    }
    return undefined
  }

  function isLoopbackHostname(host: string): boolean {
    // URL canonicalizes IPv4 literals and IPv4-mapped IPv6 addresses. Match
    // the full address to retain local privacy for mapped 127/8.
    return (
      host === "localhost" ||
      host === "localhost." ||
      host === "::1" ||
      /^127(?:\.\d{1,3}){3}$/.test(host) ||
      /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(host)
    )
  }

  export function isLoopbackBaseURL(value: unknown): boolean {
    const host = httpHostname(value)
    return host !== undefined && isLoopbackHostname(host)
  }

  export type ModelEndpoints = {
    api?: { url?: unknown }
    provider?: { api?: unknown }
  }

  export type ProviderEndpoints = {
    api?: unknown
    options?: { baseURL?: unknown }
    models?: Record<string, ModelEndpoints | undefined>
  }

  export function configuredProvider(
    providers: Record<string, ProviderEndpoints> | undefined,
    providerID: string,
  ): ProviderEndpoints | undefined {
    return providers && Object.hasOwn(providers, providerID) ? providers[providerID] : undefined
  }

  function isLocalRuntimeProvider(providerID: string): boolean {
    return LOCAL_RUNTIME_PROVIDER_IDS.some((id) => id === providerID)
  }

  function isLocalEndpoint(value: unknown): boolean {
    const host = httpHostname(value)
    return host !== undefined && (isLoopbackHostname(host) || isLocalProviderHost(host))
  }

  export function hasLocalEndpoint(provider: ProviderEndpoints | undefined, modelID?: string): boolean {
    if (!provider) return false
    if (isLocalEndpoint(provider.options?.baseURL) || isLocalEndpoint(provider.api)) return true
    const models = provider.models ?? {}
    const model = modelID && Object.hasOwn(models, modelID) ? models[modelID] : undefined
    return (model ? [model] : Object.values(models)).some(
      (entry) => isLocalEndpoint(entry?.api?.url) || isLocalEndpoint(entry?.provider?.api),
    )
  }

  /** Local inference and CLI subscriptions keep the exact provider selected by the user. */
  export function requiresExactProvider(model: Target, ...sources: (ProviderEndpoints | undefined)[]): boolean {
    return (
      isKnownCliProviderID(model.providerID) ||
      isLocalRuntimeProvider(model.providerID) ||
      sources.some((source) => hasLocalEndpoint(source, model.modelID))
    )
  }

  export const Target = z
    .object({
      providerID: z.string().trim().min(1),
      modelID: z.string().trim().min(1),
    })
    .strict()
  export type Target = z.infer<typeof Target>

  export function key(target: Target): string {
    return JSON.stringify([target.providerID, target.modelID])
  }

  export const Configuration = z
    .object({
      fallback: z
        .array(Target)
        .max(8)
        .refine(
          (targets) => new Set(targets.map(key)).size === targets.length,
          "Fallback targets must be distinct exact provider/model pairs",
        )
        .optional(),
    })
    .strict()
  export type Configuration = z.infer<typeof Configuration>

  /** A restricting source can remove entries, never grant or reorder them. */
  export function narrow(current: Configuration | undefined, restriction: Configuration): Configuration {
    if (restriction.fallback === undefined) return current ?? {}
    const allowed = new Set(restriction.fallback.map(key))
    return { fallback: (current?.fallback ?? []).filter((target) => allowed.has(key(target))) }
  }

  export function next(input: {
    current: Target
    candidates: readonly Target[]
    failed?: Iterable<string>
  }): Target | undefined {
    const failed = new Set(input.failed)
    failed.add(key(input.current))
    return input.candidates.find((target) => !failed.has(key(target)))
  }
}
