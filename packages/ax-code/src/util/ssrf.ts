import dns from "dns/promises"
import net from "net"

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
// NOTE: This check runs before `fetch()`, so it does NOT close the
// DNS-rebinding window where the OS's second resolution returns a
// different address. Closing that gap requires a custom HTTP agent
// that pins the pre-verified IP through to connect — tracked as
// BUG-15 in BUGS/. Use this helper anyway; it closes the much more
// common case of a static private URL in an untrusted config.

export namespace Ssrf {
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

  function isPrivateIPv6(addr: string): boolean {
    const lower = addr.toLowerCase()
    if (lower === "::1" || lower === "::") return true
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true // fc00::/7 ULA
    if (lower.startsWith("fe80:")) return true // link-local
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
    const addresses = await dns.lookup(hostname, { all: true }).catch(() => [])
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
}
