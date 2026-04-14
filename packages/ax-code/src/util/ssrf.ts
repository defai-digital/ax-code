import dns from "dns/promises"
import net from "net"
import { withTimeout } from "./timeout"

// SSRF guard. Resolves a URL's hostname and rejects if any resolved
// address lives in a private, reserved, loopback, link-local, or
// multicast range — covering RFC1918, cloud metadata endpoints
// (169.254.169.254 on AWS/GCP/Azure), CGNAT (100.64.0.0/10), IPv6
// ULA (fc00::/7), and their IPv4-mapped variants.
//
// Extracted from src/tool/webfetch.ts so config.ts (remote
// .well-known fetch) and session/instruction.ts (instruction URL
// fetch) can share the exact same guard without reaching into the
// webfetch tool module. Every network call that ingests a URL
// derived from user-controllable config MUST route through this
// helper — a malicious project config that points an instruction
// URL or well-known endpoint at http://169.254.169.254/ would
// otherwise exfiltrate cloud credentials through the next LLM
// prompt.
//
// `pinnedFetch` closes the DNS-rebinding window (BUG-15) by resolving
// DNS once, validating the IP, then connecting to that exact IP with
// the original Host header — preventing a second resolution that
// could return a different address.

export namespace Ssrf {
  type PinnedFetchInit = RequestInit & { label?: string }
  const MAX_REDIRECTS = 10

  function isPrivateIPv4(addr: string): boolean {
    const parts = addr.split(".").map((p) => parseInt(p, 10))
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false
    const [a, b] = parts
    if (a === 10) return true // 10.0.0.0/8
    if (a === 127) return true // loopback
    if (a === 169 && b === 254) return true // link-local, includes AWS/GCP metadata
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
    if (a === 0) return true // 0.0.0.0/8
    if (a >= 224) return true // multicast / reserved
    return false
  }

  function isRedirect(status: number) {
    return status >= 300 && status < 400
  }

  function redirectInit(init: PinnedFetchInit | undefined, status: number): PinnedFetchInit {
    const headers = new Headers(init?.headers)
    headers.delete("Host")

    const next: PinnedFetchInit = { ...init, headers, redirect: "manual" }
    const method = init?.method?.toUpperCase()
    if (status === 303 || ((status === 301 || status === 302) && method && method !== "GET" && method !== "HEAD")) {
      next.method = "GET"
      delete next.body
      headers.delete("content-length")
      headers.delete("content-type")
    }
    return next
  }

  function isPrivateIPv6(addr: string): boolean {
    const lower = addr.toLowerCase()
    if (lower === "::1" || lower === "::") return true
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true // fc00::/7 ULA
    // fe80::/10 link-local covers fe80: through febf:
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true
    if (lower.startsWith("ff")) return true // multicast
    const mapped = lower.match(/^::ffff:([0-9.]+)$/)
    if (mapped) return isPrivateIPv4(mapped[1])
    return false
  }

  /**
   * Reject if the URL's scheme is anything other than http/https, or
   * if any address it resolves to is in a private / reserved range.
   * Throws a descriptive error tagged with `label` so callers can
   * identify which fetch pipeline raised it.
   */
  export async function assertPublicUrl(url: string, label = "ssrf"): Promise<void> {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`${label}: unsupported URL scheme: ${parsed.protocol}`)
    }
    const hostname = parsed.hostname
    if (net.isIP(hostname)) {
      const bad = net.isIP(hostname) === 4 ? isPrivateIPv4(hostname) : isPrivateIPv6(hostname)
      if (bad) throw new Error(`${label}: refusing to fetch private/reserved address: ${hostname}`)
      return
    }
    const addresses = await withTimeout(
      dns.lookup(hostname, { all: true }),
      5_000,
      `DNS lookup timed out after 5s: ${hostname}`,
    ).catch(() => [])
    if (addresses.length === 0) {
      throw new Error(`${label}: could not resolve hostname: ${hostname}`)
    }
    for (const { address, family } of addresses) {
      const bad = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address)
      if (bad) {
        throw new Error(`${label}: refusing to fetch ${hostname} — resolves to private/reserved address ${address}`)
      }
    }
  }

  /**
   * Resolve DNS once, validate the IP, then fetch using the resolved IP
   * directly. Prevents DNS rebinding attacks where a second DNS lookup
   * returns a different (private) address between the SSRF check and
   * the actual connection.
   *
   * The URL is rewritten to use the resolved IP, and the original Host
   * header is set so TLS SNI and virtual hosting work correctly.
   */
  async function pinnedFetchOnce(url: string, init: PinnedFetchInit | undefined, label: string): Promise<Response> {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`${label}: unsupported URL scheme: ${parsed.protocol}`)
    }

    const hostname = parsed.hostname

    // If already an IP literal, just validate and fetch directly
    if (net.isIP(hostname)) {
      const bad = net.isIP(hostname) === 4 ? isPrivateIPv4(hostname) : isPrivateIPv6(hostname)
      if (bad) throw new Error(`${label}: refusing to fetch private/reserved address: ${hostname}`)
      const { label: _, ...fetchInit } = init ?? {}
      return fetch(url, { ...fetchInit, redirect: "manual" })
    }

    // Resolve DNS once
    const addresses = await withTimeout(
      dns.lookup(hostname, { all: true }),
      5_000,
      `DNS lookup timed out after 5s: ${hostname}`,
    ).catch(() => [])
    if (addresses.length === 0) {
      throw new Error(`${label}: could not resolve hostname: ${hostname}`)
    }

    // Validate ALL resolved addresses
    for (const { address, family } of addresses) {
      const bad = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address)
      if (bad) {
        throw new Error(`${label}: refusing to fetch ${hostname} — resolves to private/reserved address ${address}`)
      }
    }

    // Use the first valid address. Rewrite the URL to connect to the
    // resolved IP directly, preventing a second DNS lookup.
    const resolved = addresses[0]
    const pinnedUrl = new URL(url)
    const isIPv6 = resolved.family === 6
    pinnedUrl.hostname = isIPv6 ? `[${resolved.address}]` : resolved.address

    // Preserve the original Host header for TLS SNI and virtual hosting
    const headers = new Headers(init?.headers)
    if (!headers.has("Host")) {
      headers.set("Host", parsed.port ? `${hostname}:${parsed.port}` : hostname)
    }

    const { label: _, ...fetchInit } = init ?? {}
    return fetch(pinnedUrl.toString(), {
      ...fetchInit,
      headers,
      redirect: "manual",
      // Bun supports `tls.serverName` for SNI override when connecting
      // to an IP that differs from the Host header
      ...(parsed.protocol === "https:" ? { tls: { serverName: hostname } } : {}),
    } as RequestInit)
  }

  export async function pinnedFetch(url: string, init?: PinnedFetchInit): Promise<Response> {
    const label = init?.label ?? "ssrf"
    const redirectMode = init?.redirect ?? "follow"
    let currentUrl = url
    let currentInit = { ...init, redirect: "manual" } as PinnedFetchInit

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      const response = await pinnedFetchOnce(currentUrl, currentInit, label)
      if (!isRedirect(response.status)) return response
      if (redirectMode === "manual") return response
      if (redirectMode === "error") throw new Error(`${label}: redirect refused: ${currentUrl}`)
      if (redirectCount === MAX_REDIRECTS) {
        throw new Error(`${label}: too many redirects while fetching: ${url}`)
      }

      const location = response.headers.get("location")
      if (!location) return response
      currentUrl = new URL(location, currentUrl).toString()
      currentInit = redirectInit(currentInit, response.status)
    }

    throw new Error(`${label}: too many redirects while fetching: ${url}`)
  }
}
