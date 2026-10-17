// Startup network environment handling for the Node runtime.
//
// Two Node 26 realities this module exists to absorb:
//
// 1. The built-in `fetch` ignores HTTP_PROXY / HTTPS_PROXY unless
//    `http.setGlobalProxyFromEnv()` is called (or NODE_USE_ENV_PROXY=1 is set).
//    Without it, every provider, MCP, and models.dev request goes direct even
//    when the user configured a proxy.
// 2. When a proxy is enabled, the local gateway (127.0.0.1:38080), the local
//    server, ax-engine, and other loopback endpoints must keep bypassing it.
//    NO_PROXY therefore has to include the local addresses without ever
//    overwriting entries the user already set.
//
// It also optionally widens the TLS trust store to the OS certificates
// (`tls.getCACertificates("system")`) so corporate/system roots work in-process,
// while leaving NODE_EXTRA_CA_CERTS behavior intact.
//
// Every side effect is idempotent: the CLI, the TUI worker thread, and repeated
// bootstrap passes may all call `initNetworkEnv()` and only the first effective
// call does work.

import { createRequire } from "node:module"
import { Log } from "./log"

// ESM module: use createRequire for the lazy node:http / node:tls loads below.
const nodeRequire = createRequire(import.meta.url)

// Local addresses that must never be sent through a proxy: the loopback
// gateway, and *.local mDNS names used on a LAN.
export const LOCAL_NO_PROXY = ["localhost", "127.0.0.1", "::1", "*.local"] as const

export type ProxyEnv = Readonly<Record<string, string | undefined>>

/** The proxy variables Node's `setGlobalProxyFromEnv` reads (upper and lower case). */
const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] as const

/** Returns true when any proxy variable is set to a non-empty value. */
export function hasProxyEnv(env: ProxyEnv): boolean {
  return PROXY_KEYS.some((key) => (env[key] ?? "").trim().length > 0)
}

/**
 * Redact the userinfo of a proxy URL so a `user:password@host` proxy never
 * reaches a log line. Any value containing `@` is treated as carrying
 * userinfo and everything up to the last `@` is replaced with `***`, whether
 * or not `URL` recognizes the value as having real credentials (a malformed
 * value like `user:secret@broken` parses with an empty host, so a purely
 * URL-based check would leak it).
 */
export function redactProxyUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const at = trimmed.lastIndexOf("@")
  if (at === -1) return trimmed
  return `***${trimmed.slice(at)}`
}

/**
 * Append the local-bypass hosts to an existing NO_PROXY value. User entries are
 * preserved and duplicates are skipped (case-insensitive, comma or whitespace
 * separated inputs both accepted).
 */
export function mergeNoProxy(existing: string | undefined, extra: readonly string[] = LOCAL_NO_PROXY): string {
  const seen = new Set<string>()
  const parts: string[] = []
  const push = (value: string) => {
    const token = value.trim()
    if (!token) return
    const key = token.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    parts.push(token)
  }
  for (const token of (existing ?? "").split(/[,\s]+/)) push(token)
  for (const token of extra) push(token)
  return parts.join(",")
}

/** The relevant env values, in a stable order for deterministic reporting. */
export function proxyEnvSummary(env: ProxyEnv): string {
  return PROXY_KEYS.filter((key) => (env[key] ?? "").trim().length > 0)
    .map((key) => `${key}=${redactProxyUrl(env[key] ?? "")}`)
    .join(", ")
}

// Minimal structural types so tests can inject fakes without casting to the
// full node:http / node:tls module shapes.
export type HttpNetworkApi = {
  setGlobalProxyFromEnv?: (env?: ProxyEnv) => (() => void) | undefined
}
export type TlsNetworkApi = {
  getCACertificates?: (kind: "system" | "bundled" | "extra") => string[] | undefined
  setDefaultCACertificates?: (certs: string[]) => void
}
export type NetworkLogger = {
  debug: (message: string, extra?: Record<string, unknown>) => void
  warn: (message: string, extra?: Record<string, unknown>) => void
}

export type NetworkEnvState = {
  proxyApplied: boolean
  systemCaApplied: boolean
}

export type InitNetworkEnvInput = {
  env?: ProxyEnv
  http?: HttpNetworkApi
  tls?: TlsNetworkApi
  log?: NetworkLogger
  /**
   * Loads the OS certificates off the calling thread. Defaults to a worker thread when `tls` is not injected;
   * an injected `tls` without this keeps the synchronous path (tests).
   */
  loadSystemCa?: () => Promise<string[] | undefined>
}

// Reading the OS trust store is a blocking system call: on macOS it took about 3 s on a cold keychain cache
// and about 50 ms once warm. It therefore runs in a short-lived worker thread so startup and the event loop
// never wait on it. Requests that must honor corporate roots call `awaitSystemCa()` first.
const SYSTEM_CA_WORKER_SOURCE = `
const { parentPort } = require("node:worker_threads")
const tls = require("node:tls")
try {
  parentPort.postMessage({ certs: tls.getCACertificates("system") })
} catch (error) {
  parentPort.postMessage({ error: String(error && error.message ? error.message : error) })
}
`

/** Upper bound for a request waiting on the OS trust store; past it the bundled roots are used. */
export const SYSTEM_CA_WAIT_MS = 10_000

export function loadSystemCertificatesInWorker(): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: string[] | undefined) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const { Worker } = nodeRequire("node:worker_threads") as typeof import("node:worker_threads")
      const worker = new Worker(SYSTEM_CA_WORKER_SOURCE, { eval: true })
      // Never keep the process alive for a certificate read.
      worker.unref()
      worker.once("message", (message: { certs?: unknown }) => {
        finish(
          Array.isArray(message?.certs) && message.certs.every((cert) => typeof cert === "string")
            ? message.certs
            : undefined,
        )
        void worker.terminate()
      })
      worker.once("error", () => finish(undefined))
      worker.once("exit", () => finish(undefined))
    } catch {
      finish(undefined)
    }
  })
}

// Module-level guard: the first effective call wins; later calls are no-ops.
// Tests reset it through `__resetNetworkEnvForTest`.
let applied: NetworkEnvState | undefined
let systemCaPending: Promise<void> | undefined

/**
 * Resolves once the system CA certificates are installed (or loading failed, was disabled or timed out).
 * Resolved immediately when nothing is pending, so it is cheap to call before every request.
 */
export async function awaitSystemCa(timeoutMs = SYSTEM_CA_WAIT_MS): Promise<void> {
  const pending = systemCaPending
  if (!pending) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
    timer.unref?.()
  })
  try {
    await Promise.race([pending, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** Snapshot of what init actually applied, for the doctor check and tests. */
export function networkEnvState(): NetworkEnvState {
  return applied ?? { proxyApplied: false, systemCaApplied: false }
}

function loadHttp(): HttpNetworkApi {
  try {
    // Lazy so this module stays importable from non-Node test environments.
    return nodeRequire("node:http") as HttpNetworkApi
  } catch {
    return {}
  }
}

function loadTls(): TlsNetworkApi {
  try {
    return nodeRequire("node:tls") as TlsNetworkApi
  } catch {
    return {}
  }
}

/**
 * Apply proxy and system-CA handling once. Idempotent and safe to call from
 * every entry point (CLI bootstrap and the TUI worker thread, which does not
 * inherit the main thread's global dispatcher).
 */
export function initNetworkEnv(input: InitNetworkEnvInput = {}): NetworkEnvState {
  const env = input.env ?? process.env
  const log = input.log ?? Log.Default
  const http = input.http ?? loadHttp()
  const tls = input.tls ?? loadTls()

  if (applied) return applied

  const state: NetworkEnvState = { proxyApplied: false, systemCaApplied: false }

  if (hasProxyEnv(env)) {
    // Rebuild the env passed to Node so we can append the local-bypass hosts
    // without mutating process.env. setGlobalProxyFromEnv accepts an env object
    // (Node 26); when the runtime does not pass it through we fall back to the
    // process environment, preserving user NO_PROXY entries either way.
    const mergedNoProxy = mergeNoProxy(env.NO_PROXY ?? env.no_proxy)
    const proxyEnv: Record<string, string | undefined> = { ...env, NO_PROXY: mergedNoProxy }
    try {
      if (typeof http.setGlobalProxyFromEnv === "function") {
        http.setGlobalProxyFromEnv(proxyEnv)
        state.proxyApplied = true
        log.debug("network: proxy enabled from environment", {
          proxies: proxyEnvSummary(env),
          no_proxy: mergedNoProxy,
        })
      } else {
        log.debug("network: proxy env set but setGlobalProxyFromEnv is unavailable", {
          proxies: proxyEnvSummary(env),
        })
      }
    } catch (error) {
      // An invalid proxy URL must not take down startup; fall through to direct
      // connections and surface the reason at debug level.
      log.warn("network: could not enable proxy from environment", {
        error: error instanceof Error ? error.message : String(error),
        proxies: proxyEnvSummary(env),
      })
    }
  }

  if (!env.AX_CODE_DISABLE_SYSTEM_CA) {
    const mergeAndInstall = (system: string[] | undefined) => {
      try {
        if (typeof tls.getCACertificates !== "function" || typeof tls.setDefaultCACertificates !== "function") return
        const bundled = tls.getCACertificates("bundled") ?? []
        if (system && system.length > 0) {
          // Always keep the bundled roots first so a broken/empty OS store
          // cannot strip Node's own trust anchors; NODE_EXTRA_CA_CERTS is
          // merged by Node itself and stays in effect.
          const known = new Set(bundled)
          tls.setDefaultCACertificates([...bundled, ...system.filter((cert) => !known.has(cert))])
          state.systemCaApplied = true
          log.debug("network: system CA certificates added", {
            bundled: bundled.length,
            system: system.length,
          })
        } else {
          log.debug("network: system CA store empty; keeping bundled certificates", { bundled: bundled.length })
        }
      } catch (error) {
        log.debug("network: could not load system CA certificates", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const loader = input.loadSystemCa ?? (input.tls ? undefined : loadSystemCertificatesInWorker)
    if (loader) {
      const pending: Promise<void> = loader()
        .then(mergeAndInstall)
        .catch((error) => {
          log.debug("network: could not load system CA certificates", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          if (systemCaPending === pending) systemCaPending = undefined
        })
      systemCaPending = pending
    } else {
      try {
        mergeAndInstall(tls.getCACertificates?.("system"))
      } catch (error) {
        log.debug("network: could not load system CA certificates", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  applied = state
  return state
}

/** Test-only: clear the idempotency guard so a test can re-run init. */
export function __resetNetworkEnvForTest(): void {
  applied = undefined
  systemCaPending = undefined
}
