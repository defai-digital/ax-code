// Local-model transport: pick an undici dispatcher for endpoints that prefill
// large prompts.
//
// Node's built-in fetch uses undici's defaults: a 300s `headersTimeout` and
// `bodyTimeout`. A local server (ax-engine, LM Studio, Ollama, llama.cpp, the
// custom gateway) can silently prefill a large prompt for longer than that, and
// the request dies with UND_ERR_HEADERS_TIMEOUT / UND_ERR_BODY_TIMEOUT — even
// when the provider sets `timeout: false`, because that option only governs the
// ax-code watchdog, not undici's transport limits.
//
// For requests that target a local/private host — or whose provider explicitly
// disables the timeout — we attach a shared undici Agent with both transport
// timeouts disabled. The ax-code watchdogs then remain the only timeouts. Public
// hosts keep undici's defaults so a stalled remote can still fail fast.

// Structural type: undici's Dispatcher, without importing undici at type level
// (the package is loaded lazily and may be absent in some runtimes).
export type RequestDispatcher = unknown

export type DispatcherFactory = () => RequestDispatcher | undefined

/**
 * True when `host` is a loopback, private (RFC1918 / IPv6 ULA / link-local),
 * mDNS, or single-label host — i.e. a local model server rather than a public
 * API endpoint.
 *
 * IPv4/IPv6 literals are matched by range; names are matched by suffix/shape.
 * A bare `localhost` and `*.local` are always local. Anything with a dot and a
 * public IPv4/IPv6 address is NOT local.
 */
export function isLocalProviderHost(host: string): boolean {
  const value = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
  if (!value) return false

  // Named local hosts.
  if (value === "localhost" || value.endsWith(".localhost")) return true
  if (value === "local" || value.endsWith(".local")) return true
  if (value.endsWith(".internal")) return true

  // IPv6 literal.
  if (value.includes(":")) {
    // ::1 loopback, fe80::/10 link-local, fc00::/7 unique-local.
    if (value === "::1" || value === "0:0:0:0:0:0:0:1") return true
    if (/^fe[89ab][0-9a-f]:/.test(value)) return true
    if (/^f[cd][0-9a-f]{2}:/.test(value)) return true
    return false
  }

  // IPv4 literal.
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 127) return true // loopback 127.0.0.0/8
    if (a === 10) return true // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 169 && b === 254) return true // link-local 169.254.0.0/16
    if (a === 0) return true // "this host" 0.0.0.0
    return false
  }

  // Single-label host (no dot) is treated as local, e.g. `ollama`, `lmstudio`.
  if (!value.includes(".")) return true

  return false
}

/** Extract the hostname from a request target, tolerating Request/URL/string. */
export function hostFromRequest(input: string | URL | Request): string | undefined {
  try {
    if (typeof input === "string") return new URL(input).hostname
    if (input instanceof URL) return input.hostname
    return new URL(input.url).hostname
  } catch {
    return undefined
  }
}

// Lazily created, process-wide Agent with transport timeouts disabled. One
// instance keeps connections pooled across local-model requests. The module is
// loaded with a bundler-visible dynamic import() so it ships inside the
// single-file runtime but costs nothing until a local request needs it.
let sharedAgent: RequestDispatcher | undefined
let agentLoad: Promise<void> | undefined

/** Load undici and create the shared Agent. Never throws: failure leaves default timeouts. */
export function ensureLocalDispatcher(): Promise<void> {
  agentLoad ??= import("undici")
    .then(({ Agent }) => {
      sharedAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30_000 }) as RequestDispatcher
    })
    .catch(() => {
      sharedAgent = undefined
    })
  return agentLoad
}

function defaultDispatcherFactory(): RequestDispatcher | undefined {
  return sharedAgent
}

export type DispatcherDecisionInput = {
  url: string | URL | Request
  timeoutDisabled?: boolean
}

/**
 * Decide whether the request should use the local dispatcher, and return it.
 * Pure w.r.t. its inputs except for the memoized agent; callers pass a factory
 * in tests.
 */
export function needsLocalDispatcher(input: DispatcherDecisionInput): boolean {
  const host = hostFromRequest(input.url)
  return (host ? isLocalProviderHost(host) : false) || Boolean(input.timeoutDisabled)
}

export function selectDispatcher(
  input: DispatcherDecisionInput,
  factory: DispatcherFactory = defaultDispatcherFactory,
): RequestDispatcher | undefined {
  const host = hostFromRequest(input.url)
  const local = host ? isLocalProviderHost(host) : false
  if (!local && !input.timeoutDisabled) return undefined
  return factory()
}

/** Test-only: reset the memoized agent so a test can inject a fake factory. */
export function __resetLocalDispatcherForTest(): void {
  sharedAgent = undefined
  agentLoad = undefined
}
