// ADR-246: request-time bearer tokens for the `azure_cli` credential source.
//
// The Azure SDK only accepts an API key, so the provider options carry a
// placeholder key and the wrapped fetch replaces the `api-key` header with
// `Authorization: Bearer <token>` taken from `az account get-access-token`.
// The token is cached in memory until shortly before expiry and is never
// logged, stored or exported.

import { parseJsonResult } from "@ax-code/util/json-value"
import { Process } from "@/util/process"

export namespace AzureToken {
  export const RESOURCE = "https://cognitiveservices.azure.com"
  /** Not a secret: it only lets the SDK construct, and is stripped before the request leaves. */
  export const PLACEHOLDER_KEY = "azure-cli-managed"
  const REFRESH_MARGIN_MS = 5 * 60 * 1000
  // Must exceed the refresh margin, otherwise a token without a parsable expiry
  // is refetched on every request.
  const FALLBACK_TTL_MS = 10 * 60 * 1000
  const TIMEOUT_MS = 20_000
  // Tenant and subscription come from a stored (possibly imported) reference and become argv
  // entries, so anything that could be read as an option is refused.
  const SAFE_ARGUMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

  export interface Reference {
    tenant?: string
    subscription?: string
  }
  export type Exec = (args: string[], signal?: AbortSignal) => Promise<{ code: number; stdout: string }>

  export function command(reference: Reference): string[] | undefined {
    const args = ["az", "account", "get-access-token", "--resource", RESOURCE, "--output", "json"]
    for (const [flag, value] of [
      ["--tenant", reference.tenant],
      ["--subscription", reference.subscription],
    ] as const) {
      if (value === undefined) continue
      if (!SAFE_ARGUMENT.test(value)) return undefined
      args.push(flag, value)
    }
    return args
  }

  const defaultExec: Exec = async (args, signal) => {
    const result = await Process.run(args, { timeout: TIMEOUT_MS, nothrow: true, abort: signal })
    return { code: result.code, stdout: result.stdout.toString() }
  }

  export function parseToken(stdout: string, now: number): { token: string; expiresAt: number } | undefined {
    const parsed = parseJsonResult(stdout)
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") return undefined
    const body = parsed.value as Record<string, unknown>
    const token = body["accessToken"]
    if (typeof token !== "string" || token.length === 0) return undefined
    const rawEpoch = body["expires_on"]
    const epoch = typeof rawEpoch === "string" && rawEpoch.trim() !== "" ? Number(rawEpoch) : rawEpoch
    const expiresOn = body["expiresOn"]
    let expiresAt = now + FALLBACK_TTL_MS
    if (typeof epoch === "number" && Number.isFinite(epoch) && epoch > 0) expiresAt = epoch * 1000
    else if (typeof expiresOn === "string" && Number.isFinite(Date.parse(expiresOn))) expiresAt = Date.parse(expiresOn)
    return { token, expiresAt }
  }

  function abortReason(signal: AbortSignal): unknown {
    return signal.reason
  }

  /** Single-flight cached token source. Failures are not cached so `az login` takes effect at once. */
  export function create(reference: Reference, input: { exec?: Exec; now?: () => number } = {}) {
    const exec = input.exec ?? defaultExec
    const now = input.now ?? Date.now
    let cached: { token: string; expiresAt: number } | undefined
    let pending: Promise<string> | undefined
    const args = command(reference)
    async function fetchToken() {
      if (!args) throw new Error("Azure CLI credential source has an invalid tenant or subscription reference")
      let result: { code: number; stdout: string }
      try {
        // The lookup is shared by concurrent callers, so it must not inherit a
        // single caller's signal; its own timeout bounds the process.
        result = await exec(args)
      } catch {
        throw new Error("Azure CLI is unavailable; install it and run `az login`")
      }
      const parsed = result.code === 0 ? parseToken(result.stdout, now()) : undefined
      if (!parsed) throw new Error("Azure CLI could not provide an access token; run `az login`")
      cached = parsed
      return parsed.token
    }
    return {
      async get(signal?: AbortSignal): Promise<string> {
        // Cancellation applies to cache hits as well as shared lookups.
        if (signal?.aborted) throw abortReason(signal)
        if (cached && cached.expiresAt - now() > REFRESH_MARGIN_MS) return cached.token
        const request = (pending ??= fetchToken().finally(() => {
          pending = undefined
        }))
        // One caller's abort must not fail the others waiting on the same lookup.
        if (!signal) return request
        return new Promise<string>((resolve, reject) => {
          const onAbort = () => {
            signal.removeEventListener("abort", onAbort)
            reject(abortReason(signal))
          }
          signal.addEventListener("abort", onAbort, { once: true })
          request.then(
            (token) => {
              signal.removeEventListener("abort", onAbort)
              resolve(token)
            },
            (error) => {
              signal.removeEventListener("abort", onAbort)
              reject(error)
            },
          )
          // Starting the shared lookup can synchronously cancel this caller.
          // Keep the request handlers attached so its rejection is observed.
          if (signal.aborted) onAbort()
        })
      },
    }
  }

  /** Wrap a fetch so each request carries a fresh bearer token instead of the placeholder key. */
  export function wrapFetch(
    fetchFn: typeof fetch,
    source: { get(signal?: AbortSignal): Promise<string> },
  ): typeof fetch {
    return (async (input: string | Request | URL, init?: RequestInit) => {
      // Explicit null removes the Request signal, while undefined inherits it.
      const signal = init?.signal === undefined ? (input instanceof Request ? input.signal : undefined) : init.signal
      // Fetch replaces Request headers when init supplies them; it does not merge.
      const headers = new Headers(
        init?.headers === undefined && input instanceof Request ? input.headers : init?.headers,
      )
      // Snapshot caller-owned options before the asynchronous token lookup.
      const requestInit = { ...init, headers }
      const token = await source.get(signal ?? undefined)
      if (signal?.aborted) throw abortReason(signal)
      headers.delete("api-key")
      headers.set("authorization", `Bearer ${token}`)
      return fetchFn(input, requestInit)
    }) as typeof fetch
  }
}
