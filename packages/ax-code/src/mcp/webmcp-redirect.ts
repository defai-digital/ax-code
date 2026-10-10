import { WebMcpProfile } from "./webmcp-profile"

/** The minimal fetch shape the probe needs; injected so tests need no network. */
export type ProbeFetch = (
  url: string,
  init: { method: string; redirect: "manual"; signal: AbortSignal },
) => Promise<{ status: number; headers: { get(name: string): string | null } }>

export const MAX_REDIRECT_HOPS = 5
// 304 and 300/305/306 may carry a Location header without being a redirect.
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])
// setTimeout fires immediately for delays above 2^31 - 1.
const MAX_TIMER_MS = 2 ** 31 - 1
export const REDIRECT_PROBE_TIMEOUT_MS = 4_000

export type RedirectProbeOptions = { timeoutMs?: number; signal?: AbortSignal }

/**
 * Find the first origin a redirect chain leads to that is outside the
 * allowlist, WITHOUT ever requesting an origin outside the allowlist.
 *
 * `requestedUrl` was already validated by `validateCall` and its origin
 * approved by the user. The probe issues credential-less HEAD requests and
 * reads only the `Location` header: it follows a hop only while that hop's
 * origin is already in `allowedOrigins`, so every request it makes targets an
 * origin the user already allowed. The first `Location` outside the allowlist
 * is returned and never fetched itself.
 *
 * This exists because the pinned bridge surfaces an allowlist-blocked redirect
 * as a generic network error (`net::ERR_INTERNET_DISCONNECTED at <requested>`)
 * that does not name the target; the target otherwise appears only in the
 * untrusted page title, which must never decide an origin.
 *
 * Fails closed (returns undefined) on a non-grantable start URL, a response
 * that is not 3xx, a 3xx without a usable `Location`, a non-grantable Location
 * (other scheme, credentials, `blob:`), the hop cap, or the timeout.
 */
export async function redirectOriginOutsideAllowlist(
  requestedUrl: string,
  allowedOrigins: readonly string[],
  fetchImpl: ProbeFetch,
  options: RedirectProbeOptions = {},
): Promise<string | undefined> {
  const allowed = new Set(allowedOrigins)
  const startOrigin = WebMcpProfile.grantableOrigin(requestedUrl)
  if (!startOrigin || !allowed.has(startOrigin)) return undefined
  if (options.signal?.aborted) return undefined
  const timeoutMs = Math.min(options.timeoutMs ?? REDIRECT_PROBE_TIMEOUT_MS, MAX_TIMER_MS)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return undefined
  const deadline = Date.now() + timeoutMs
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  options.signal?.addEventListener("abort", onAbort, { once: true })
  // The deadline must end the probe even if the fetch implementation never
  // settles on abort: race every hop against the controller's own signal.
  // The sentinel is handled up front so a late abort after the probe
  // returned cannot surface as an unhandled rejection.
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("WebMCP redirect probe aborted")), {
      once: true,
    })
  })
  aborted.catch(() => undefined)
  try {
    let current = requestedUrl
    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
      if (controller.signal.aborted || Date.now() >= deadline) return undefined
      let response: Awaited<ReturnType<ProbeFetch>>
      try {
        response = await Promise.race([
          fetchImpl(current, { method: "HEAD", redirect: "manual", signal: controller.signal }),
          aborted,
        ])
      } catch {
        return undefined
      }
      if (controller.signal.aborted || Date.now() >= deadline) return undefined
      if (!REDIRECT_STATUSES.has(response.status)) return undefined
      // Reading the hop is fail-closed too: a response object whose header
      // accessor throws, or a Location that does not parse, ends the probe.
      let next: URL
      try {
        const location = response.headers.get("location")
        if (!location) return undefined
        next = new URL(location, current)
      } catch {
        return undefined
      }
      const nextOrigin = WebMcpProfile.grantableOrigin(next.toString())
      if (!nextOrigin) return undefined
      if (allowed.has(nextOrigin)) {
        current = next.toString()
        continue
      }
      return nextOrigin
    }
    return undefined
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", onAbort)
    // Settle the sentinel so a never-fired listener holds nothing after return.
    controller.abort()
  }
}
