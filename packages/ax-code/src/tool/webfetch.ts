import z from "zod"
import dns from "dns/promises"
import net from "net"
import { Tool } from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { abortAfterAny } from "../util/abort"
import { WEBFETCH_MAX_RESPONSE_SIZE as MAX_RESPONSE_SIZE, WEBFETCH_DEFAULT_TIMEOUT as DEFAULT_TIMEOUT, WEBFETCH_MAX_TIMEOUT as MAX_TIMEOUT } from "@/constants/network"
import { Isolation } from "@/isolation"

// Block SSRF to private/reserved IP ranges. Without this, an LLM could
// instruct webfetch to hit the local server (localhost:4096), cloud
// metadata endpoints (169.254.169.254 on AWS/GCP), or internal network
// services (10.x, 172.16-31.x, 192.168.x). We resolve the hostname and
// reject addresses in RFC1918, loopback, link-local, and CGNAT ranges
// for both IPv4 and IPv6.
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
  // IPv4-mapped (::ffff:x.x.x.x) — check the embedded IPv4
  const mapped = lower.match(/^::ffff:([0-9.]+)$/)
  if (mapped) return isPrivateIPv4(mapped[1])
  return false
}

async function assertPublicUrl(url: string): Promise<void> {
  const parsed = new URL(url)
  const hostname = parsed.hostname
  // If the hostname is already a literal IP, check it directly.
  if (net.isIP(hostname)) {
    const bad = net.isIP(hostname) === 4 ? isPrivateIPv4(hostname) : isPrivateIPv6(hostname)
    if (bad) throw new Error(`webfetch: refusing to fetch private/reserved address: ${hostname}`)
    return
  }
  // Resolve all A and AAAA records; reject if any resolve to a private
  // address. Checking every address prevents DNS rebinding bypass.
  const addresses = await dns.lookup(hostname, { all: true }).catch(() => [])
  if (addresses.length === 0) {
    throw new Error(`webfetch: could not resolve hostname: ${hostname}`)
  }
  for (const { address, family } of addresses) {
    const bad = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address)
    if (bad) {
      throw new Error(`webfetch: refusing to fetch ${hostname} — resolves to private/reserved address ${address}`)
    }
  }
}

export const WebFetchTool = Tool.define("webfetch", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .default("markdown")
      .describe("The format to return the content in (text, markdown, or html). Defaults to markdown."),
    timeout: z.number().describe("Optional timeout in seconds (max 120)").optional(),
  }),
  async execute(params, ctx) {
    // Validate URL
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://")
    }

    Isolation.assertNetwork(ctx.extra?.isolation)

    // SSRF guard: resolve the hostname and reject private/reserved IPs
    // (RFC1918, loopback, link-local, CGNAT, multicast). See the
    // assertPublicUrl helper at the top of the file for details.
    await assertPublicUrl(params.url)

    await ctx.ask({
      permission: "webfetch",
      patterns: [params.url],
      always: ["*"],
      metadata: {
        url: params.url,
        format: params.format,
        timeout: params.timeout,
      },
    })

    const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

    const { signal, clearTimeout } = abortAfterAny(timeout, ctx.abort)

    // Build Accept header based on requested format with q parameters for fallbacks
    let acceptHeader = "*/*"
    switch (params.format) {
      case "markdown":
        acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
        break
      case "text":
        acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
        break
      case "html":
        acceptHeader = "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
        break
      default:
        acceptHeader =
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    }
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      Accept: acceptHeader,
      "Accept-Language": "en-US,en;q=0.9",
    }

    try {
      const initial = await fetch(params.url, { signal, headers })

      // Retry with honest UA if blocked by Cloudflare bot detection (TLS fingerprint mismatch)
      let response = initial
      if (initial.status === 403 && initial.headers.get("cf-mitigated") === "challenge") {
        await initial.body?.cancel().catch(() => {})
        response = await fetch(params.url, { signal, headers: { ...headers, "User-Agent": "ax-code" } })
      }

      if (!response.ok) {
        throw new Error(`Request failed with status code: ${response.status}`)
      }

      // Check content length
      const contentLength = response.headers.get("content-length")
      if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
        throw new Error("Response too large (exceeds 5MB limit)")
      }

      const arrayBuffer = await response.arrayBuffer()
      if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
        throw new Error("Response too large (exceeds 5MB limit)")
      }

      const contentType = response.headers.get("content-type") || ""
      const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
      const title = `${params.url} (${contentType})`

      // Check if response is an image
      const isImage = mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"

      if (isImage) {
        const base64Content = Buffer.from(arrayBuffer).toString("base64")
        return {
          title,
          output: "Image fetched successfully",
          metadata: {},
          attachments: [
            {
              type: "file",
              mime,
              url: `data:${mime};base64,${base64Content}`,
            },
          ],
        }
      }

      const content = new TextDecoder().decode(arrayBuffer)

      // Handle content based on requested format and actual content type
      switch (params.format) {
        case "markdown":
          if (contentType.includes("text/html")) {
            const markdown = convertHTMLToMarkdown(content)
            return {
              output: markdown,
              title,
              metadata: {},
            }
          }
          return {
            output: content,
            title,
            metadata: {},
          }

        case "text":
          if (contentType.includes("text/html")) {
            const text = await extractTextFromHTML(content)
            return {
              output: text,
              title,
              metadata: {},
            }
          }
          return {
            output: content,
            title,
            metadata: {},
          }

        case "html":
          return {
            output: content,
            title,
            metadata: {},
          }

        default:
          return {
            output: content,
            title,
            metadata: {},
          }
      }
    } finally {
      clearTimeout()
    }
  },
})

async function extractTextFromHTML(html: string) {
  let text = ""
  let skipContent = false

  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, iframe, object, embed", {
      element() {
        skipContent = true
      },
      text() {
        // Skip text content inside these elements
      },
    })
    .on("*", {
      element(element) {
        // Reset skip flag when entering other elements
        if (!["script", "style", "noscript", "iframe", "object", "embed"].includes(element.tagName)) {
          skipContent = false
        }
      },
      text(input) {
        if (!skipContent) {
          text += input.text
        }
      },
    })
    .transform(new Response(html))

  await rewriter.text()
  return text.trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}
