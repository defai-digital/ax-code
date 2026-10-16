/**
 * Loopback-only egress allowlist proxy for sandboxed bash (ADR-232).
 *
 * Started lazily for a single sandboxed command when `isolation.network`
 * carries an `allowed_domains` list, and stopped when that command ends. It
 * listens on an ephemeral 127.0.0.1 port and:
 * - forwards absolute-URI HTTP requests and CONNECT tunnels,
 * - admits only hosts matching `allowed_domains` (exact or `*.suffix`),
 * - applies `denied_domains` first (a denial always wins),
 * - refuses targets that resolve to a private/loopback/link-local address and
 *   connects to the resolved IP (never re-resolves) to close the rebinding gap,
 * - enforces a connect timeout and a header-size limit,
 * - logs denials by host only and never request bodies.
 */

import dns from "node:dns"
import http from "node:http"
import net from "node:net"
import { Log } from "@/util/log"

export namespace EgressProxy {
  const log = Log.create({ service: "isolation.egress" })

  export type Config = {
    allowedDomains: string[]
    deniedDomains?: string[]
  }

  export type Handle = {
    port: number
    url: string
    /** Number of requests refused since the proxy started. */
    denials: () => number
    stop: () => Promise<void>
  }

  const DEFAULT_CONNECT_TIMEOUT_MS = 15_000
  const DEFAULT_MAX_HEADER_BYTES = 16 * 1024

  /** Lowercase and strip a single trailing root dot. Empty when unusable. */
  export function normalizeHost(host: string): string {
    return host.trim().toLowerCase().replace(/\.$/, "")
  }

  function ruleMatches(host: string, rule: string): boolean {
    const normalized = normalizeHost(rule)
    if (!normalized) return false
    if (normalized.startsWith("*.")) {
      const suffix = normalized.slice(2)
      return host === suffix || host.endsWith(`.${suffix}`)
    }
    return host === normalized
  }

  /**
   * Whether `host` is permitted. `denied_domains` is evaluated first and a
   * single match refuses the host even when the allowlist would admit it.
   */
  export function isAllowed(host: string, config: Config): boolean {
    const normalized = normalizeHost(host)
    if (!normalized) return false
    if ((config.deniedDomains ?? []).some((rule) => ruleMatches(normalized, rule))) return false
    return config.allowedDomains.some((rule) => ruleMatches(normalized, rule))
  }

  function isPrivateIPv4(ip: string): boolean {
    const parts = ip.split(".")
    if (parts.length !== 4) return false
    const octets = parts.map((part) => Number(part))
    if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false
    const [a, b, c] = octets
    if (a === 0) return true // "this network"
    if (a === 10) return true // private
    if (a === 127) return true // loopback
    if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
    if (a === 169 && b === 254) return true // link-local
    if (a === 172 && b >= 16 && b <= 31) return true // private
    if (a === 192 && b === 168) return true // private
    if (a === 192 && b === 0 && c === 0) return true // IETF protocol assignments
    if (a === 192 && b === 0 && c === 2) return true // documentation
    if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
    if (a >= 224) return true // multicast and reserved
    return false
  }

  /**
   * True for any address a sandboxed command must not reach: loopback,
   * private, link-local, unspecified, multicast, and IPv6 unique-local
   * addresses. IPv4-mapped IPv6 (`::ffff:a.b.c.d`) delegates to the IPv4 rules.
   */
  export function isPrivateAddress(ip: string): boolean {
    const trimmed = ip.trim()
    if (!trimmed) return true
    const zone = trimmed.indexOf("%")
    const clean = (zone >= 0 ? trimmed.slice(0, zone) : trimmed).toLowerCase()
    // Any dotted quad (plain IPv4 or IPv4-mapped IPv6) is judged by IPv4 rules.
    if (clean.includes(".")) return isPrivateIPv4(clean.slice(clean.lastIndexOf(":") + 1))
    if (clean === "::" || clean === "::1") return true
    if (clean.startsWith("fe8") || clean.startsWith("fe9") || clean.startsWith("fea") || clean.startsWith("feb"))
      return true
    if (clean.startsWith("fc") || clean.startsWith("fd")) return true // unique local
    if (clean.startsWith("ff")) return true // multicast
    return false
  }

  /** Proxy environment for the sandboxed child; loopback must bypass it. */
  export function proxyEnv(port: number, platform: NodeJS.Platform = process.platform): Record<string, string> {
    const url = `http://127.0.0.1:${port}`
    const env: Record<string, string> = {
      HTTP_PROXY: url,
      HTTPS_PROXY: url,
      http_proxy: url,
      https_proxy: url,
      ALL_PROXY: url,
      all_proxy: url,
      NO_PROXY: "localhost,127.0.0.1,::1",
      no_proxy: "localhost,127.0.0.1,::1",
    }
    // An empty variable would make some runtimes treat the host as proxy-targeted.
    if (platform === "win32") delete env.NO_PROXY
    return env
  }

  export type StartInput = Config & {
    connectTimeoutMs?: number
    maxHeaderBytes?: number
    /** Test seam: resolve a hostname to a single address (default: dns.lookup). */
    lookup?: (host: string, done: (error: Error | null, address: string, family: number) => void) => void
    /** Test seam: private-address predicate (default: isPrivateAddress). */
    isPrivate?: (address: string) => boolean
  }

  /**
   * Start the proxy on an ephemeral loopback port. The caller owns the handle
   * and must `stop()` it when the sandboxed command finishes.
   */
  export function start(input: StartInput): Promise<Handle> {
    const config: Config = { allowedDomains: input.allowedDomains, deniedDomains: input.deniedDomains }
    const connectTimeoutMs = input.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    const maxHeaderBytes = input.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES
    const resolveHost =
      input.lookup ??
      ((host: string, done: (error: Error | null, address: string, family: number) => void) =>
        dns.lookup(host, (error, address, family) => done(error, address, family)))
    const privateAddress = input.isPrivate ?? isPrivateAddress
    let denials = 0
    const denied = (host: string, reason: string) => {
      denials += 1
      log.warn("egress denied", { host, reason })
    }

    const server = http.createServer({ maxHeaderSize: maxHeaderBytes })

    server.on("request", (req, res) => {
      let target: URL
      try {
        target = new URL(req.url ?? "")
      } catch {
        res.writeHead(400).end("Egress proxy requires an absolute request URI")
        return
      }
      const host = target.hostname
      if (!isAllowed(host, config)) {
        denied(host, "not-allowlisted")
        res.writeHead(403).end("Blocked by egress allowlist")
        return
      }
      resolveHost(host, (error, address, family) => {
        if (error) {
          denied(host, "dns-failure")
          res.writeHead(502).end("Egress proxy could not resolve host")
          return
        }
        if (privateAddress(address)) {
          denied(host, "private-address")
          res.writeHead(403).end("Blocked by egress allowlist (private address)")
          return
        }
        const upstream = http.request(
          {
            host: address,
            family,
            port: target.port || 80,
            method: req.method,
            path: `${target.pathname}${target.search}`,
            headers: { ...req.headers, host: target.host },
          },
          (upstreamRes) => {
            res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
            upstreamRes.pipe(res)
          },
        )
        upstream.setTimeout(connectTimeoutMs, () => upstream.destroy(new Error("egress connect timeout")))
        upstream.on("error", () => {
          if (res.headersSent) res.end()
          else res.writeHead(502).end("Egress proxy upstream error")
        })
        req.pipe(upstream)
      })
    })

    server.on("connect", (req, clientSocket, head) => {
      const [rawHost, rawPort] = (req.url ?? "").split(":")
      const host = rawHost ?? ""
      const port = Number.parseInt(rawPort ?? "", 10) || 443
      const refuse = (reason: string) => {
        denied(host, reason)
        clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n")
        clientSocket.destroy()
      }
      if (!isAllowed(host, config)) {
        refuse("not-allowlisted")
        return
      }
      resolveHost(host, (error, address, family) => {
        if (error) {
          refuse("dns-failure")
          return
        }
        if (privateAddress(address)) {
          refuse("private-address")
          return
        }
        const upstream = net.connect({ host: address, port, family }, () => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
          if (head?.length) upstream.write(head)
          upstream.pipe(clientSocket)
          clientSocket.pipe(upstream)
        })
        upstream.setTimeout(connectTimeoutMs, () => upstream.destroy())
        upstream.on("error", () => clientSocket.destroy())
        clientSocket.on("error", () => upstream.destroy())
      })
    })

    return new Promise<Handle>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject)
        const address = server.address()
        if (!address || typeof address === "string") {
          reject(new Error("egress proxy did not bind a loopback port"))
          return
        }
        log.info("egress proxy started", { port: address.port, allowed: config.allowedDomains.length })
        resolve({
          port: address.port,
          url: `http://127.0.0.1:${address.port}`,
          denials: () => denials,
          stop: () =>
            new Promise<void>((done) => {
              server.closeAllConnections?.()
              server.close(() => done())
            }),
        })
      })
    })
  }
}
