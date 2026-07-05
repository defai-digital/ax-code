import z from "zod"
import { Tool } from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { abortAfterAny } from "../util/abort"
import { Ssrf } from "../util/ssrf"
import {
  WEBFETCH_MAX_RESPONSE_SIZE as MAX_RESPONSE_SIZE,
  WEBFETCH_DEFAULT_TIMEOUT as DEFAULT_TIMEOUT,
  WEBFETCH_MAX_TIMEOUT as MAX_TIMEOUT,
} from "@/constants/network"
import { Isolation } from "@/isolation"
import { parseContentLengthHeader } from "@/util/http-header"
import { ToolNumber } from "./schema"
import { originPermissionPatterns } from "@/util/url-permission"

// Block SSRF to private/reserved IP ranges. Uses pinnedFetch to
// resolve DNS once and connect to the validated IP directly —
// prevents DNS rebinding attacks (BUG-15).
const assertPublicUrl = (url: string) => Ssrf.assertPublicUrl(url, "webfetch")
const pinnedFetch = (url: string, init?: RequestInit) => Ssrf.pinnedFetch(url, { ...init, label: "webfetch" })

export const WebFetchTool = Tool.define("webfetch", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    format: z
      .enum(["text", "markdown", "html"])
      .default("markdown")
      .describe("The format to return the content in (text, markdown, or html). Defaults to markdown."),
    timeout: ToolNumber(z.number().min(1)).describe("Optional timeout in seconds (max 120)").optional(),
  }),
  async execute(params, ctx) {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(params.url)
    } catch {
      throw new Error("URL must start with http:// or https://")
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
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
      always: originPermissionPatterns(parsedUrl),
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

    let response: Response | undefined
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    let bodyConsumed = false

    try {
      // Manual redirect handling so each hop gets DNS-pinned and
      // re-validated. Uses pinnedFetch which resolves DNS once and
      // connects to the validated IP directly — closes the DNS
      // rebinding window (BUG-15). The default `fetch` follows
      // redirects internally without any hook to inspect the target.
      const MAX_REDIRECTS = 10
      let currentUrl = params.url
      for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
        const attemptHeaders = hop === 0 ? headers : { ...headers }
        let res = await pinnedFetch(currentUrl, { signal, headers: attemptHeaders, redirect: "manual" })

        // Retry with honest UA only on the initial request if blocked
        // by Cloudflare bot detection (TLS fingerprint mismatch).
        if (hop === 0 && res.status === 403 && res.headers.get("cf-mitigated") === "challenge") {
          await res.body?.cancel().catch(() => {})
          res = await pinnedFetch(currentUrl, {
            signal,
            headers: { ...attemptHeaders, "User-Agent": "ax-code" },
            redirect: "manual",
          })
        }

        // 3xx with a Location header → re-validate target and loop.
        // Anything else (including opaqueredirect from same-origin
        // fetches) falls through to the response-handling path.
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location")
          await res.body?.cancel().catch(() => {})
          if (!location) {
            throw new Error(`Redirect response missing Location header (status ${res.status})`)
          }
          const next = new URL(location, currentUrl).toString()
          await assertPublicUrl(next)
          currentUrl = next
          continue
        }

        response = res
        break
      }

      if (!response) {
        throw new Error(`Too many redirects (>${MAX_REDIRECTS})`)
      }

      if (!response.ok) {
        throw new Error(`Request failed with status code: ${response.status}`)
      }

      // Check content length header first
      const contentLengthBytes = parseContentLengthHeader(response.headers.get("content-length"))
      if (contentLengthBytes !== undefined && contentLengthBytes > MAX_RESPONSE_SIZE) {
        throw new Error("Response too large (exceeds 5MB limit)")
      }

      // Stream response with size limit to prevent OOM from chunked
      // responses that omit Content-Length. Previously the entire body
      // was buffered via response.arrayBuffer() before the size check,
      // meaning a malicious server could send gigabytes before we
      // noticed.
      reader = response.body?.getReader()
      if (!reader) throw new Error("Response has no body")
      const chunks: Uint8Array[] = []
      let totalBytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        totalBytes += value.byteLength
        if (totalBytes > MAX_RESPONSE_SIZE) {
          await reader.cancel().catch(() => {})
          throw new Error("Response too large (exceeds 5MB limit)")
        }
        chunks.push(value)
      }
      reader.releaseLock()
      reader = undefined
      bodyConsumed = true
      const assembled = new Uint8Array(totalBytes)
      let byteOffset = 0
      for (const chunk of chunks) {
        assembled.set(chunk, byteOffset)
        byteOffset += chunk.byteLength
      }
      const arrayBuffer = assembled.buffer

      const contentType = response.headers.get("content-type") || ""
      const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
      const charset = contentType.match(/charset=([^;\s]+)/i)?.[1]?.trim()
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

      const content = (() => {
        try {
          return new TextDecoder(charset || "utf-8").decode(arrayBuffer)
        } catch {
          return new TextDecoder().decode(arrayBuffer)
        }
      })()

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
      try {
        reader?.releaseLock()
      } catch {}
      if (!bodyConsumed) {
        await response?.body?.cancel().catch(() => {})
      }
    }
  },
})

function extractTextFromHTML(html: string): string {
  // Best-effort plain-text extraction: drop non-content elements (and their
  // contents) entirely, strip the remaining tags, then decode entities and
  // collapse whitespace. Ports the previous Bun-only HTMLRewriter pass to plain
  // Node so webfetch works under the Node runtime.
  const withoutSkipped = html.replace(/<(script|style|noscript|iframe|object)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
  const withoutComments = withoutSkipped.replace(/<!--[\s\S]*?-->/g, " ")
  const withoutTags = withoutComments.replace(/<[^>]+>/g, " ")
  return decodeHtmlEntities(withoutTags)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
}

function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  }
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const codePoint = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      // Guard the full Unicode range — `String.fromCodePoint` throws RangeError
      // on out-of-range values, which `Number.isFinite` alone does not catch.
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match
    }
    return named[body.toLowerCase()] ?? match
  })
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
