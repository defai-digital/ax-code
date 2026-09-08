import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { toErrorMessage } from "../util/error-message"
import { FIGMA_DESKTOP_MCP_URL, FIGMA_MCP_ORIGIN, FIGMA_MCP_DOCS_URL } from "./constants"

const TRANSIENT_ERRNO = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
])

const TRANSIENT_MESSAGE =
  /\b(fetch failed|socket hang up|econnreset|econnrefused|etimedout|eai_again|network (?:error|unreachable)|connection reset|temporarily unavailable|429|502|503|504)\b/i

function errnoCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

/** Fast network blips worth a second connect try. Auth, registration, and budget timeouts are not. */
export function isTransientMcpConnectError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof UnauthorizedError) return false
  const message = toErrorMessage(error)
  if (/timed out after \d+ms/i.test(message)) return false
  if (/Invalid OAuth error response/i.test(message)) return false
  if (/\b(401|403|404)\b/.test(message) && !/\b(502|503|504)\b/.test(message)) return false
  const code = errnoCode(error)
  if (code && TRANSIENT_ERRNO.has(code)) return true
  return TRANSIENT_MESSAGE.test(message)
}

export function combineTransportErrors(errors: ReadonlyArray<{ name: string; error: unknown }>): string {
  const parts = errors.map(({ name, error }) => `${name}: ${toErrorMessage(error)}`)
  if (parts.length === 0) return "Unknown error"
  if (parts.length === 1) return toErrorMessage(errors[0]!.error)
  return parts.join("; ")
}

/** Default User-Agent plus caller headers. An empty User-Agent override is dropped. */
export function mergeRemoteMcpHeaders(
  headers: Record<string, string> | undefined,
  userAgent: string,
): Record<string, string> {
  const merged: Record<string, string> = {}
  let resolved = userAgent
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === "user-agent") {
      const trimmed = value.trim()
      if (trimmed) resolved = trimmed
      continue
    }
    merged[key] = value
  }
  merged["User-Agent"] = resolved
  return merged
}

export function mcpClientUserAgent(version: string): string {
  return `ax-code/${version}`
}

export function mcpRegistrationRejection(name: string, url: string): string {
  if (new URL(url).origin === FIGMA_MCP_ORIGIN) {
    return (
      `Figma rejected OAuth client registration for "${name}". ` +
      "Figma remote MCP requires an approved client in the Figma MCP Catalog; ordinary OAuth app credentials do not establish MCP access. " +
      `See ${FIGMA_MCP_DOCS_URL} for client registration requirements. ` +
      `For local access, enable Figma Desktop MCP and configure ${FIGMA_DESKTOP_MCP_URL} with allowLoopback: true and oauth: false.`
    )
  }
  return (
    `Dynamic client registration was rejected by "${name}". ` +
    "The server may require a pre-registered client ID; provide oauth.clientId and, only if required by the server, oauth.clientSecret."
  )
}
