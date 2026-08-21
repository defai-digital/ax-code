import dns from "dns/promises"
import http from "node:http"
import https from "node:https"
import net from "net"
import { Readable } from "node:stream"
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

type FetchFn = (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
type DnsResolveFn = (hostname: string) => Promise<{ address: string; family: number }[]>

export namespace Ssrf {
  type PinnedFetchInit = RequestInit & { label?: string }
  type ResolvedAddress = { address: string; family: number }
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
    if (a === 192 && b === 0 && parts[2] === 0) return true // 192.0.0.0/24 IETF protocol assignments
    if (a === 192 && b === 0 && parts[2] === 2) return true // 192.0.2.0/24 TEST-NET-1
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
    if (a === 198 && b >= 18 && b <= 19) return true // 198.18.0.0/15 benchmarking
    if (a === 198 && b === 51 && parts[2] === 100) return true // 198.51.100.0/24 TEST-NET-2
    if (a === 203 && b === 0 && parts[2] === 113) return true // 203.0.113.0/24 TEST-NET-3
    if (a === 0) return true // 0.0.0.0/8
    if (a >= 224) return true // multicast / reserved
    return false
  }

  function isRedirect(status: number) {
    return status >= 300 && status < 400
  }

  function redirectInit(init: PinnedFetchInit | undefined, status: number, crossOrigin: boolean): PinnedFetchInit {
    const headers = new Headers(init?.headers)
    headers.delete("Host")

    // Never forward credentials across an origin boundary on redirect — a
    // redirect from a trusted endpoint to an attacker host must not leak the
    // API key / cookies. Matches browser fetch semantics.
    if (crossOrigin) {
      headers.delete("authorization")
      headers.delete("cookie")
      headers.delete("proxy-authorization")
    }

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

  // Expand any valid IPv6 literal (compressed `::`, embedded dotted IPv4,
  // uncompressed, zone id) to its 16 bytes. Returns null only for input that is
  // not a parseable IPv6 — callers treat that as "reject" since net.isIP has
  // already vouched the literal is IPv6.
  function ipv6ToBytes(input: string): number[] | null {
    let addr = input.trim().toLowerCase()
    const zone = addr.indexOf("%")
    if (zone !== -1) addr = addr.slice(0, zone)

    // Rewrite a trailing dotted-quad (e.g. ::ffff:127.0.0.1) into two hextets so
    // both dotted and hex forms of IPv4-mapped/compatible addresses parse.
    const lastColon = addr.lastIndexOf(":")
    if (lastColon !== -1 && addr.slice(lastColon + 1).includes(".")) {
      const v4 = addr.slice(lastColon + 1).split(".")
      if (v4.length !== 4) return null
      const octets: number[] = []
      for (const part of v4) {
        if (!/^\d{1,3}$/.test(part)) return null
        const n = Number(part)
        if (n > 255) return null
        octets.push(n)
      }
      const hi = ((octets[0] << 8) | octets[1]).toString(16)
      const lo = ((octets[2] << 8) | octets[3]).toString(16)
      addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`
    }

    const halves = addr.split("::")
    if (halves.length > 2) return null
    const head = halves[0] ? halves[0].split(":") : []
    const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : null

    let hextets: number[]
    if (tail === null) {
      if (head.length !== 8) return null
      hextets = head.map((h) => parseInt(h, 16))
    } else {
      const missing = 8 - (head.length + tail.length)
      if (missing < 1) return null // `::` must stand in for at least one group
      hextets = [...head, ...Array(missing).fill("0"), ...tail].map((h) => parseInt(h, 16))
    }
    if (hextets.length !== 8 || hextets.some((h) => !Number.isInteger(h) || h < 0 || h > 0xffff)) return null

    const bytes: number[] = []
    for (const h of hextets) bytes.push((h >> 8) & 0xff, h & 0xff)
    return bytes
  }

  function isPrivateIPv6(addr: string): boolean {
    const b = ipv6ToBytes(addr)
    if (!b) return true // unparseable IPv6 literal → fail closed
    if (b.every((x) => x === 0)) return true // :: unspecified
    if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true // ::1 loopback
    if ((b[0] & 0xfe) === 0xfc) return true // fc00::/7 ULA
    if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true // fe80::/10 link-local
    if (b[0] === 0xff) return true // ff00::/8 multicast
    // IPv4-mapped ::ffff:0:0/96 — check the embedded IPv4 in BOTH dotted and hex
    // forms (e.g. ::ffff:7f00:1 == 127.0.0.1, ::ffff:a9fe:a9fe == 169.254.169.254).
    if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) {
      return isPrivateIPv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`)
    }
    // IPv4-compatible ::/96 (deprecated) — embeds an IPv4 in the low 32 bits.
    if (b.slice(0, 12).every((x) => x === 0)) {
      return isPrivateIPv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`)
    }
    // NAT64 64:ff9b::/96 — embeds an IPv4 that could route to a private host.
    if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
      return isPrivateIPv4(`${b[12]}.${b[13]}.${b[14]}.${b[15]}`)
    }
    return false
  }

  // URL.hostname keeps the brackets on IPv6 literals (e.g. "[::1]"), which
  // net.isIP does not accept. Strip them so IPv6 literals hit the IP-literal
  // branch (and are validated) instead of falling through to a DNS lookup of a
  // bracketed string — which both leaks public IPv6 fetches and skips the check.
  function ipFromHostname(hostname: string): string {
    return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname
  }

  function responseHeaders(headers: http.IncomingHttpHeaders): Headers {
    const result = new Headers()
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) continue
      if (Array.isArray(value)) {
        for (const item of value) result.append(key, item)
      } else {
        result.set(key, value)
      }
    }
    return result
  }

  function requestBody(init: PinnedFetchInit | undefined): BodyInit | undefined {
    return init?.body === null ? undefined : init?.body
  }

  async function nodePinnedHttpsFetch(input: {
    originalUrl: URL
    resolvedAddress: string
    headers: Headers
    init: PinnedFetchInit | undefined
    hostname: string
  }): Promise<Response> {
    const method = input.init?.method ?? "GET"
    const body = requestBody(input.init)
    const requestHeaders = Object.fromEntries(input.headers.entries())

    return new Promise<Response>((resolve, reject) => {
      const servername = net.isIP(input.hostname) ? undefined : input.hostname
      const req = https.request(
        {
          protocol: input.originalUrl.protocol,
          host: input.resolvedAddress,
          hostname: input.resolvedAddress,
          port: input.originalUrl.port || 443,
          method,
          path: `${input.originalUrl.pathname}${input.originalUrl.search}`,
          headers: requestHeaders,
          ...(servername ? { servername } : {}),
        },
        (res) => {
          const webBody = Readable.toWeb(res) as ReadableStream<Uint8Array>
          resolve(
            new Response(webBody, {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage,
              headers: responseHeaders(res.headers),
            }),
          )
        },
      )

      req.on("error", reject)
      input.init?.signal?.addEventListener(
        "abort",
        () => {
          req.destroy(input.init?.signal?.reason)
          reject(input.init?.signal?.reason ?? new DOMException("The operation was aborted", "AbortError"))
        },
        { once: true },
      )

      if (body === undefined || method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD") {
        req.end()
        return
      }
      if (typeof body === "string" || body instanceof Uint8Array) {
        req.end(body)
        return
      }
      if (body instanceof ArrayBuffer) {
        req.end(new Uint8Array(body))
        return
      }
      if (body instanceof URLSearchParams) {
        req.end(body.toString())
        return
      }
      reject(new TypeError("ssrf: unsupported HTTPS pinned fetch body type"))
      req.destroy()
    })
  }

  async function nodePinnedHttpFetch(input: {
    originalUrl: URL
    resolvedAddress: string
    headers: Headers
    init: PinnedFetchInit | undefined
  }): Promise<Response> {
    const method = input.init?.method ?? "GET"
    const body = requestBody(input.init)
    const requestHeaders = Object.fromEntries(input.headers.entries())

    return new Promise<Response>((resolve, reject) => {
      const req = http.request(
        {
          protocol: input.originalUrl.protocol,
          host: input.resolvedAddress,
          hostname: input.resolvedAddress,
          port: input.originalUrl.port || 80,
          method,
          path: `${input.originalUrl.pathname}${input.originalUrl.search}`,
          headers: requestHeaders,
        },
        (res) => {
          const webBody = Readable.toWeb(res) as ReadableStream<Uint8Array>
          resolve(
            new Response(webBody, {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage,
              headers: responseHeaders(res.headers),
            }),
          )
        },
      )

      req.on("error", reject)
      input.init?.signal?.addEventListener(
        "abort",
        () => {
          req.destroy(input.init?.signal?.reason)
          reject(input.init?.signal?.reason ?? new DOMException("The operation was aborted", "AbortError"))
        },
        { once: true },
      )

      if (body === undefined || method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD") {
        req.end()
        return
      }
      if (typeof body === "string" || body instanceof Uint8Array) {
        req.end(body)
        return
      }
      if (body instanceof ArrayBuffer) {
        req.end(new Uint8Array(body))
        return
      }
      if (body instanceof URLSearchParams) {
        req.end(body.toString())
        return
      }
      reject(new TypeError("ssrf: unsupported HTTP pinned fetch body type"))
      req.destroy()
    })
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
    const hostname = ipFromHostname(parsed.hostname)
    if (net.isIP(hostname)) {
      const bad = net.isIP(hostname) === 4 ? isPrivateIPv4(hostname) : isPrivateIPv6(hostname)
      if (bad) throw new Error(`${label}: refusing to fetch private/reserved address: ${hostname}`)
      return
    }
    const emptyAddresses: ResolvedAddress[] = []
    const addresses = await withTimeout(
      dns.lookup(hostname, { all: true }),
      5_000,
      `${label}: DNS lookup timed out after 5s: ${hostname}`,
    ).catch((err) => {
      // Propagate timeout errors directly so callers can distinguish
      // "DNS timed out" from "hostname does not exist".
      if (err instanceof Error && err.message.includes("timed out")) throw err
      return emptyAddresses
    })
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
  async function pinnedFetchOnce(
    url: string,
    init: PinnedFetchInit | undefined,
    label: string,
    fetchFn?: FetchFn,
    dnsResolveFn?: DnsResolveFn,
  ): Promise<Response> {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`${label}: unsupported URL scheme: ${parsed.protocol}`)
    }

    const hostname = ipFromHostname(parsed.hostname)

    // If already an IP literal, just validate and fetch directly
    if (net.isIP(hostname)) {
      const bad = net.isIP(hostname) === 4 ? isPrivateIPv4(hostname) : isPrivateIPv6(hostname)
      if (bad) throw new Error(`${label}: refusing to fetch private/reserved address: ${hostname}`)
      const { label: _, ...fetchInit } = init ?? {}
      if (fetchFn) {
        return fetchFn(url, { ...fetchInit, redirect: "manual" })
      }
      const headers = new Headers(init?.headers)
      if (!headers.has("Host")) {
        headers.set("Host", parsed.host)
      }
      if (parsed.protocol === "https:") {
        return nodePinnedHttpsFetch({
          originalUrl: parsed,
          resolvedAddress: hostname,
          headers,
          init: fetchInit,
          hostname,
        })
      }
      return nodePinnedHttpFetch({
        originalUrl: parsed,
        resolvedAddress: hostname,
        headers,
        init: fetchInit,
      })
    }

    // Resolve DNS once
    const emptyAddresses: ResolvedAddress[] = []
    const addresses = await withTimeout(
      dnsResolveFn ? dnsResolveFn(hostname) : dns.lookup(hostname, { all: true }),
      5_000,
      `${label}: DNS lookup timed out after 5s: ${hostname}`,
    ).catch((err) => {
      if (err instanceof Error && err.message.includes("timed out")) throw err
      return emptyAddresses
    })
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
    if (fetchFn) {
      return fetchFn(pinnedUrl.toString(), {
        ...fetchInit,
        headers,
        redirect: "manual",
      } as RequestInit)
    }
    if (parsed.protocol === "https:") {
      return nodePinnedHttpsFetch({
        originalUrl: parsed,
        resolvedAddress: resolved.address,
        headers,
        init: fetchInit,
        hostname,
      })
    }

    return nodePinnedHttpFetch({
      originalUrl: pinnedUrl,
      resolvedAddress: resolved.address,
      headers,
      init: fetchInit,
    })
  }

  export async function pinnedFetch(
    url: string,
    init?: PinnedFetchInit,
    fetchFn?: FetchFn,
    dnsResolveFn?: DnsResolveFn,
  ): Promise<Response> {
    const label = init?.label ?? "ssrf"
    const redirectMode = init?.redirect ?? "follow"
    let currentUrl = url
    let currentInit = { ...init, redirect: "manual" } as PinnedFetchInit

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      const response = await pinnedFetchOnce(currentUrl, currentInit, label, fetchFn, dnsResolveFn)
      if (!isRedirect(response.status)) return response
      if (redirectMode === "manual") return response
      if (redirectMode === "error") throw new Error(`${label}: redirect refused: ${currentUrl}`)
      if (redirectCount === MAX_REDIRECTS) {
        throw new Error(`${label}: too many redirects while fetching: ${url}`)
      }

      const location = response.headers.get("location")
      if (!location) return response
      const redirectUrl = new URL(location, currentUrl)
      if (redirectUrl.protocol !== "http:" && redirectUrl.protocol !== "https:") {
        throw new Error(`${label}: redirect to unsupported URL scheme: ${redirectUrl.protocol}`)
      }
      const crossOrigin = new URL(currentUrl).origin !== redirectUrl.origin
      currentUrl = redirectUrl.toString()
      currentInit = redirectInit(currentInit, response.status, crossOrigin)
    }

    throw new Error(`${label}: too many redirects while fetching: ${url}`)
  }
}
