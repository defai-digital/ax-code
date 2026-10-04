import z from "zod"
import path from "node:path"
import os from "node:os"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
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
      allowPersistentProfile: z
        .boolean()
        .optional()
        .describe(
          "Managed opt-in for a persistent AX-owned browser profile. Default off; never the user's main profile.",
        ),
      allowVendored: z
        .boolean()
        .optional()
        .describe("Managed opt-in for a vendored, integrity-pinned bridge install instead of npx. Default off."),
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
      persistentProfile: z
        .boolean()
        .optional()
        .describe(
          "Use a persistent AX-owned browser profile so authenticated WebMCP tools work. Requires the managed allowPersistentProfile requirement and forces a visible window.",
        ),
      vendored: z
        .boolean()
        .optional()
        .describe(
          "Launch a vendored, integrity-pinned bridge install instead of npx. Requires the managed allowVendored requirement.",
        ),
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

  function profileDirectory(profile: Configuration): string {
    const key = createHash("sha256").update(profile.allowedOrigins.join("\n")).digest("hex").slice(0, 16)
    return path.join(os.homedir(), ".ax-code", "webmcp-profiles", key)
  }

  export const VENDORED_PACKAGE = PACKAGE
  // Pinned integrity of chrome-devtools-mcp@1.8.0, the exact reviewed package.
  export const VENDORED_INTEGRITY =
    "sha512-Wrm9z0/5WbVs778apjWgYRkpe9bvYQWjK2zVRwqoPAtz1IHQ5+GvotM07UGXJcfrA0rj6Gt1Pnn5+w/Tf1nU4w=="

  export function vendoredDir(): string {
    return path.join(os.homedir(), ".ax-code", "vendor", `chrome-devtools-mcp-${PACKAGE.split("@")[1]}`)
  }

  export function vendoredBin(): string {
    return path.join(
      vendoredDir(),
      "node_modules",
      "chrome-devtools-mcp",
      "build",
      "src",
      "bin",
      "chrome-devtools-mcp.js",
    )
  }

  /** Verify the installed package's lockfile integrity against the reviewed pin. */
  export function verifyLockfileIntegrity(lockfile: string): { ok: true } | { ok: false; error: string } {
    const parsed = parseJsonPayload(lockfile)
    if (!isRecord(parsed)) {
      return { ok: false, error: "WebMCP vendored lockfile is not valid JSON" }
    }
    const packages = isRecord(parsed) && isRecord(parsed.packages) ? parsed.packages : {}
    const entry = isRecord(packages["node_modules/chrome-devtools-mcp"])
      ? (packages["node_modules/chrome-devtools-mcp"] as Record<string, unknown>)
      : undefined
    if (entry?.integrity !== VENDORED_INTEGRITY) {
      return { ok: false, error: "WebMCP vendored install integrity does not match the reviewed pin" }
    }
    return { ok: true }
  }

  function command(profile: Configuration): string[] {
    return [
      // A vendored profile launches the integrity-pinned local install; the
      // default npx form resolves the same pinned version from the registry.
      ...(profile.vendored ? ["node", vendoredBin()] : ["npx", "-y", PACKAGE]),
      // A persistent profile holds real cookies, so it is always a dedicated
      // AX-owned directory with a visible window — never the user's main
      // profile and never headless.
      ...(profile.persistentProfile
        ? [`--user-data-dir=${profileDirectory(profile)}`]
        : ["--isolated", ...(profile.headless ? ["--headless"] : [])]),
      "--no-usage-statistics",
      "--no-performance-crux",
      "--no-category-emulation",
      "--no-category-performance",
      "--no-category-network",
      "--category-experimental-webmcp",
      "--experimental-structured-content",
      "--chrome-arg=--enable-features=WebMCP",
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
    | { ok: false; reason: "managed_policy" | "managed_origins" | "persistent_profile" | "vendored" }

  export function blockedMessage(
    reason: "managed_policy" | "managed_origins" | "persistent_profile" | "vendored",
  ): string {
    return reason === "managed_policy"
      ? "WebMCP bridge is disabled by managed policy"
      : reason === "persistent_profile"
        ? "WebMCP persistent profile is not allowed by managed policy"
        : reason === "vendored"
          ? "WebMCP vendored install is not allowed by managed policy"
          : "WebMCP managed policy excludes every origin configured for this bridge"
  }

  /**
   * Evaluate a managed requirement against a launch-validated profile. A deny or
   * a narrowing that admits no origin fails closed with a reason the caller can
   * surface as a distinct blocked state; a partial narrowing only makes the
   * call-time origin check stricter than the browser allowlist. A persistent
   * profile requires the managed `allowPersistentProfile` opt-in.
   */
  export function evaluate(requirement: Requirement | undefined, profile: Configuration): PolicyDecision {
    if (requirement && requirement.allow === false) return { ok: false, reason: "managed_policy" }
    if (profile.persistentProfile === true && requirement?.allowPersistentProfile !== true) {
      return { ok: false, reason: "persistent_profile" }
    }
    if (profile.vendored === true && requirement?.allowVendored !== true) {
      return { ok: false, reason: "vendored" }
    }
    if (!requirement) return { ok: true, profile }
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
    annotations?: ToolDescriptor["annotations"],
  ): Record<string, unknown> {
    return {
      server,
      tool,
      allowedOrigins: [...profile.allowedOrigins],
      ...(typeof call.pageId === "number" ? { pageId: call.pageId } : {}),
      ...(typeof call.toolName === "string" ? { toolName: call.toolName } : {}),
      ...(typeof call.url === "string" ? { origin: new URL(call.url).origin } : {}),
      ...(typeof call.input === "string" ? { inputBytes: Buffer.byteLength(call.input, "utf8") } : {}),
      ...(annotations
        ? {
            annotations: {
              readOnly: annotations.readOnly === true,
              untrustedContent: annotations.untrustedContent === true,
              consequential: annotations.consequential === true,
            },
          }
        : {}),
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

  export const MAX_TOOLS = 50
  export const MAX_DESCRIPTOR_BYTES = 64 * 1024
  export const MAX_REGISTRATION_CHANGES = 10
  const PAGE_LINE = /^(\d+):\s+(.*)$/
  const PAGE_URL = /(https?:\/\/[^\s)\]]+)/

  export type ToolDescriptor = {
    name: string
    description?: string
    inputSchema?: unknown
    annotations?: { readOnly?: boolean; untrustedContent?: boolean; consequential?: boolean }
  }

  type PageState = {
    tools: Map<string, string>
    annotations: Map<string, ToolDescriptor["annotations"]>
    changes: number
    disabled: boolean
  }
  export type ListingState = { pages: Map<number, PageState> }
  export type ListingResult = { ok: true } | { ok: false; error: string }

  // The live profile object is recreated per connection (validateLaunch parses
  // fresh each time) and frozen, so keying listing state by it yields
  // per-connection state without threading a store through the MCP layer.
  const listingStates = new WeakMap<Configuration, ListingState>()

  export function stateFor(profile: Configuration): ListingState {
    let state = listingStates.get(profile)
    if (!state) {
      state = { pages: new Map() }
      listingStates.set(profile, state)
    }
    return state
  }

  /** Parse the structured tool descriptors chrome-devtools-mcp returns. */
  export function parseToolListing(result: unknown): ToolDescriptor[] | undefined {
    const record = isRecord(result) ? result : {}
    const structured = isRecord(record.structuredContent) ? record.structuredContent : undefined
    if (!structured || !Array.isArray(structured.webmcpTools)) return undefined
    const descriptors: ToolDescriptor[] = []
    for (const raw of structured.webmcpTools) {
      if (!isRecord(raw) || typeof raw.name !== "string" || raw.name.length === 0) return undefined
      descriptors.push({
        name: raw.name,
        description: typeof raw.description === "string" ? raw.description : undefined,
        inputSchema: raw.inputSchema,
        annotations: isRecord(raw.annotations)
          ? {
              readOnly: raw.annotations.readOnly === true,
              untrustedContent: raw.annotations.untrustedContent === true,
              consequential: raw.annotations.consequential === true,
            }
          : undefined,
      })
    }
    return descriptors
  }

  /** Parse `list_pages` text into pageId -> URL (non-http pages keep raw text). */
  export function parsePages(text: string): Map<number, string> {
    const pages = new Map<number, string>()
    for (const line of text.split("\n")) {
      const match = PAGE_LINE.exec(line)
      if (!match) continue
      pages.set(Number(match[1]), PAGE_URL.exec(match[2])?.[1] ?? match[2].trim())
    }
    return pages
  }

  function descriptorHash(descriptor: ToolDescriptor): string {
    return createHash("sha256")
      .update(JSON.stringify([descriptor.name, descriptor.description ?? "", descriptor.inputSchema ?? null]))
      .digest("hex")
  }

  function descriptorBytes(descriptors: ToolDescriptor[]): number {
    return Buffer.byteLength(JSON.stringify(descriptors), "utf8")
  }

  function sameTools(a: Map<string, string>, b: Map<string, string>): boolean {
    if (a.size !== b.size) return false
    for (const [name, hash] of a) if (b.get(name) !== hash) return false
    return true
  }

  /**
   * Record a page's tool listing, enforcing the descriptor caps. Excessive tool
   * count or descriptor bytes fail closed; repeated definition churn past the
   * limit disables the page (it protects against approval-fatigue attacks).
   */
  export function recordListing(state: ListingState, pageId: number, descriptors: ToolDescriptor[]): ListingResult {
    if (descriptors.length > MAX_TOOLS) {
      return { ok: false, error: `WebMCP page registers too many tools (${descriptors.length} > ${MAX_TOOLS})` }
    }
    if (descriptorBytes(descriptors) > MAX_DESCRIPTOR_BYTES) {
      return { ok: false, error: "WebMCP tool descriptors exceed the descriptor size limit" }
    }
    const tools = new Map<string, string>()
    const annotations = new Map<string, ToolDescriptor["annotations"]>()
    for (const descriptor of descriptors) {
      tools.set(descriptor.name, descriptorHash(descriptor))
      annotations.set(descriptor.name, descriptor.annotations)
    }
    const existing = state.pages.get(pageId)
    const changes = existing && !sameTools(existing.tools, tools) ? existing.changes + 1 : (existing?.changes ?? 0)
    if (changes > MAX_REGISTRATION_CHANGES) {
      state.pages.set(pageId, { tools, annotations, changes, disabled: true })
      return { ok: false, error: "WebMCP tool definitions changed too many times on this page" }
    }
    state.pages.set(pageId, { tools, annotations, changes, disabled: false })
    return { ok: true }
  }

  /** Approval-time annotations for a tool, when the model already listed it. */
  export function annotationsFor(
    profile: Configuration,
    pageId: number,
    toolName: string,
  ): ToolDescriptor["annotations"] | undefined {
    const page = listingStates.get(profile)?.pages.get(pageId)
    if (!page || page.disabled) return undefined
    return page.annotations.get(toolName)
  }

  /**
   * Verify a fresh listing still matches what the model saw. `pageUrl` is the
   * page's current URL from a fresh `list_pages`; a missing page or an origin
   * that left the allowlist fails closed.
   */
  export function verifyBinding(
    profile: Configuration,
    pageId: number,
    toolName: string,
    descriptors: ToolDescriptor[],
    pageUrl?: string,
  ): ListingResult {
    const page = listingStates.get(profile)?.pages.get(pageId)
    if (!page) return { ok: false, error: "WebMCP execute requires list_webmcp_tools to be called first" }
    if (page.disabled) return { ok: false, error: "WebMCP tool definitions are disabled for this page" }
    if (pageUrl === undefined) return { ok: false, error: "WebMCP page could not be located before execution" }
    let origin: string
    try {
      origin = new URL(pageUrl).origin
    } catch {
      return { ok: false, error: "WebMCP page URL could not be verified" }
    }
    if (!profile.allowedOrigins.includes(origin)) {
      return { ok: false, error: "WebMCP page origin is no longer allowed" }
    }
    const stored = page.tools.get(toolName)
    if (stored === undefined) return { ok: false, error: `WebMCP tool ${toolName} was not in the listed tools` }
    const fresh = descriptors.find((descriptor) => descriptor.name === toolName)
    if (!fresh) return { ok: false, error: `WebMCP tool ${toolName} is no longer registered` }
    if (descriptorHash(fresh) !== stored) {
      return { ok: false, error: `WebMCP tool ${toolName} definition changed since it was listed` }
    }
    return { ok: true }
  }

  export const MIN_CHROME_MAJOR = 150

  /** Parse the major version from `chrome --version` output. */
  export function chromeMajor(version: string): number | undefined {
    const match = /(\d+)\./.exec(version.trim())
    return match ? Number(match[1]) : undefined
  }

  /**
   * Fail-closed preflight for an explicit Chrome executable. The pinned bridge
   * needs Chrome 150+ for the WebMCP surface; a stale or non-Chrome binary must
   * be rejected before a browser is launched.
   */
  export function verifyChromeVersion(executablePath: string): { ok: true } | { ok: false; error: string } {
    let output: string
    try {
      output = execFileSync(executablePath, ["--version"], { encoding: "utf8", timeout: 10_000 })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: `Could not run the configured Chrome executable: ${message}` }
    }
    const major = chromeMajor(output)
    if (major === undefined) {
      return { ok: false, error: "Could not read the Chrome version from the configured executable" }
    }
    if (major < MIN_CHROME_MAJOR) {
      return { ok: false, error: `WebMCP requires Chrome ${MIN_CHROME_MAJOR}+ (configured executable is ${major})` }
    }
    return { ok: true }
  }
}
