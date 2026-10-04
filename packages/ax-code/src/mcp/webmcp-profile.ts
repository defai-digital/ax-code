import z from "zod"
import path from "node:path"
import { parseJsonPayload } from "@/util/json-value"
import { isRecord } from "@/util/record"

/** Consumer policy for the pinned external bridge, not a browser engine. */
export namespace WebMcpProfile {
  export const PACKAGE = "chrome-devtools-mcp@1.8.0"
  export const MAX_INPUT_BYTES = 64 * 1024
  export const TOOLS = [
    "list_pages",
    "new_page",
    "navigate_page",
    "close_page",
    "list_webmcp_tools",
    "execute_webmcp_tool",
  ] as const
  const tools = new Set<string>(TOOLS)
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"])

  function exactOrigin(value: string): boolean {
    try {
      const url = new URL(value)
      return (
        value === url.origin &&
        !/[*+(){}\\]/.test(value) &&
        (url.protocol === "https:" || (url.protocol === "http:" && loopback.has(url.hostname)))
      )
    } catch {
      return false
    }
  }

  const Origins = z
    .array(z.string().max(240).refine(exactOrigin, "Use an exact HTTPS origin or HTTP loopback origin"))
    .min(1)
    .max(8)
    .refine((origins) => new Set(origins).size === origins.length, "Origins must be unique")

  /**
   * Managed-only enterprise requirement for the experimental bridge. It is read
   * exclusively from the managed config directory: no project, user, remote or
   * inline source may set or loosen it. `allow: false` blocks the bridge
   * outright; `allowedOrigins`, when present, narrows the exact origins admitted
   * for call-time navigation checks. A requirement can only restrict — it never
   * enables the bridge and never removes the per-call interactive approval.
   */
  export const Requirement = z
    .object({
      allow: z
        .boolean()
        .optional()
        .describe("Managed allow/deny for the experimental WebMCP bridge. false blocks the bridge entirely."),
      allowedOrigins: Origins.optional().describe(
        "Managed narrowing list. When set, only these exact origins stay usable; it must intersect the profile's configured origins.",
      ),
    })
    .strict()
    .meta({ ref: "WebMcpRequirementConfig" })
  export type Requirement = z.infer<typeof Requirement>

  export const Configuration = z
    .object({
      allowedOrigins: Origins.describe(
        "Exact permitted origins; no wildcards, credentials, paths, queries or fragments",
      ),
      headless: z.boolean().optional().describe("Use an isolated headless Chrome instead of a visible window"),
      executablePath: z
        .string()
        .max(4096)
        .refine((value) => path.isAbsolute(value) && !value.includes("\0"), "Use an absolute Chrome executable path")
        .optional()
        .describe("Optional explicit Chrome 150+ executable; never attaches to an existing browser session"),
    })
    .strict()
    .meta({ ref: "WebMcpProfileConfig" })
  export type Configuration = z.infer<typeof Configuration>
  export type Policy = { server: string; toolName: string; profile: Configuration }

  type Server = {
    type: string
    command?: string[]
    enabled?: boolean
    environment?: Record<string, string>
    webmcp?: Configuration
  }

  function command(profile: Configuration): string[] {
    return [
      "npx",
      "-y",
      PACKAGE,
      "--isolated",
      "--no-usage-statistics",
      "--no-performance-crux",
      "--no-category-emulation",
      "--no-category-performance",
      "--no-category-network",
      "--category-experimental-webmcp",
      "--experimental-structured-content",
      "--chrome-arg=--enable-features=WebMCP",
      ...(profile.headless ? ["--headless"] : []),
      ...(profile.executablePath ? [`--executable-path=${profile.executablePath}`] : []),
      ...profile.allowedOrigins.map((origin) => {
        const url = new URL(origin)
        // URLPattern treats IPv6 colons as parameter syntax unless escaped.
        const hostname = url.hostname.replaceAll(":", "\\:")
        return `--allowed-url-pattern=${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}/*`
      }),
    ]
  }

  export function config(
    input: Configuration,
    enabled = false,
  ): Server & { type: "local"; command: string[]; enabled: boolean; webmcp: Configuration } {
    const profile = Configuration.parse(input)
    return { type: "local", command: command(profile), enabled, webmcp: profile }
  }

  export function disabled(server: Server): boolean {
    return server.enabled === false || (server.webmcp !== undefined && server.enabled !== true)
  }

  export function validateLaunch(server: Server): Configuration | undefined {
    if (!server.webmcp) return undefined
    const profile = Configuration.parse(server.webmcp)
    if (server.type !== "local" || JSON.stringify(server.command) !== JSON.stringify(command(profile))) {
      throw new Error("WebMCP requires the exact reviewed launch command. Regenerate it with ax-code mcp webmcp.")
    }
    if (server.environment && Object.keys(server.environment).length > 0) {
      throw new Error("WebMCP profiles do not accept environment overrides.")
    }
    Object.freeze(profile.allowedOrigins)
    return Object.freeze(profile)
  }

  export type PolicyDecision =
    | { ok: true; profile: Configuration }
    | { ok: false; reason: "managed_policy" | "managed_origins" }

  export function blockedMessage(reason: "managed_policy" | "managed_origins"): string {
    return reason === "managed_policy"
      ? "WebMCP bridge is disabled by managed policy"
      : "WebMCP managed policy excludes every origin configured for this bridge"
  }

  /**
   * Evaluate a managed requirement against a launch-validated profile. A deny or
   * a narrowing that admits no origin fails closed with a reason the caller can
   * surface as a distinct blocked state; a partial narrowing only makes the
   * call-time origin check stricter than the browser allowlist.
   */
  export function evaluate(requirement: Requirement | undefined, profile: Configuration): PolicyDecision {
    if (!requirement) return { ok: true, profile }
    if (requirement.allow === false) return { ok: false, reason: "managed_policy" }
    const allowed = requirement.allowedOrigins
    if (!allowed) return { ok: true, profile }
    const admitted = profile.allowedOrigins.filter((origin) => allowed.includes(origin))
    if (admitted.length === 0) return { ok: false, reason: "managed_origins" }
    if (admitted.length === profile.allowedOrigins.length) return { ok: true, profile }
    const narrowed = Configuration.parse({ ...profile, allowedOrigins: admitted })
    Object.freeze(narrowed.allowedOrigins)
    return { ok: true, profile: Object.freeze(narrowed) }
  }

  /**
   * Apply a managed requirement, throwing on a managed denial. Kept for callers
   * that treat a denial as an error; MCP.create uses `evaluate` instead so the
   * same denial surfaces as a distinct blocked status.
   */
  export function applyRequirement(requirement: Requirement | undefined, profile: Configuration): Configuration {
    const decision = evaluate(requirement, profile)
    if (!decision.ok) throw new Error(blockedMessage(decision.reason))
    return decision.profile
  }

  export function allows(name: string): boolean {
    return tools.has(name)
  }

  const pageId = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
  const url = z.string().min(1).max(2048)
  const schemas = {
    list_pages: z.object({}).strict(),
    new_page: z.object({ url }).strict(),
    navigate_page: z.object({ pageId, type: z.literal("url").optional(), url }).strict(),
    close_page: z.object({ pageId }).strict(),
    list_webmcp_tools: z.object({ pageId }).strict(),
    execute_webmcp_tool: z
      .object({
        pageId,
        toolName: z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/),
        input: z.string().max(MAX_INPUT_BYTES).optional(),
      })
      .strict(),
  }

  export function callSchema(name: string) {
    if (!allows(name)) throw new Error("Tool is not admitted by the WebMCP bridge profile")
    return schemas[name as keyof typeof schemas]
  }

  export function validateCall(profile: Configuration, name: string, args: unknown): Record<string, unknown> {
    const parsed = callSchema(name).safeParse(args)
    // Do not include the page-provided input in validation errors or logs.
    if (!parsed.success) throw new Error(`Invalid arguments for WebMCP bridge tool ${name}`)
    const call: Record<string, unknown> = parsed.data
    if (typeof call.url === "string") {
      let target: URL
      try {
        target = new URL(call.url)
      } catch {
        throw new Error("WebMCP navigation requires a valid allowed URL")
      }
      if (target.username || target.password || !profile.allowedOrigins.includes(target.origin)) {
        throw new Error("WebMCP navigation origin is not allowed")
      }
    }
    if (typeof call.input === "string") {
      if (Buffer.byteLength(call.input, "utf8") > MAX_INPUT_BYTES || !isRecord(parseJsonPayload(call.input))) {
        throw new Error("WebMCP tool input must be a JSON object of at most 64 KiB")
      }
    }
    // All admitted arguments are scalars: a frozen schema copy cannot change
    // while the user is reviewing it, unlike the plugin-owned source object.
    return Object.freeze(call)
  }

  export function approvalMetadata(
    server: string,
    profile: Configuration,
    tool: string,
    call: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      server,
      tool,
      allowedOrigins: [...profile.allowedOrigins],
      ...(typeof call.pageId === "number" ? { pageId: call.pageId } : {}),
      ...(typeof call.toolName === "string" ? { toolName: call.toolName } : {}),
      ...(typeof call.url === "string" ? { origin: new URL(call.url).origin } : {}),
      ...(typeof call.input === "string" ? { inputBytes: Buffer.byteLength(call.input, "utf8") } : {}),
      experimental: true,
      warning: "Page tool definitions and results are untrusted. Approval does not guarantee the tool's effects.",
    }
  }

  export function validateResult(name: string, result: unknown): void {
    const record = isRecord(result) ? result : {}
    const structured = isRecord(record.structuredContent) ? record.structuredContent : {}
    if (record.isError === true || structured.errorMessage) {
      throw new Error("WebMCP bridge operation failed; do not retry automatically")
    }
    if (name === "execute_webmcp_tool") {
      const completion = typeof structured.message === "string" ? parseJsonPayload(structured.message) : undefined
      // MCP transport success is not page-tool success. Missing/unknown status
      // and canceled/error invocations must not become successful session parts.
      if (!isRecord(completion) || completion.status !== "Completed" || completion.errorText) {
        throw new Error("WebMCP invocation did not confirm completion; do not retry automatically")
      }
    }
    if (
      name === "navigate_page" &&
      (typeof structured.message !== "string" || !structured.message.startsWith("Successfully navigated to "))
    ) {
      throw new Error("WebMCP navigation did not confirm completion; do not retry automatically")
    }
  }
}
