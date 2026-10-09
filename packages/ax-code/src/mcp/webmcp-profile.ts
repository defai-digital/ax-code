import z from "zod"
import path from "node:path"
import os from "node:os"
import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readdirSync, readFileSync } from "node:fs"
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
  /**
   * The T1 read tier (ADR-169). These three upstream tool names are admitted
   * only when the effective profile has `read: true`; every other upstream
   * tool (evaluate_script, click, fill, upload_file, list_network_requests,
   * get_network_request, get_console_message, wait_for, handle_dialog,
   * select_page, resize_page, stay) remains rejected at every tier.
   */
  export const READ_TOOLS = ["take_snapshot", "take_screenshot", "list_console_messages"] as const
  /**
   * Every tool the per-origin read grant admits (ADR-171, ADR-172): the three
   * content readers plus read-only network metadata. The grant prompt names
   * this set; the per-call origin preflight covers all of it.
   */
  export const READ_SCOPE_TOOLS = [...READ_TOOLS, "list_network_requests"] as const
  /**
   * Resource types the pinned chrome-devtools-mcp@1.8.0 bridge accepts
   * (FILTERABLE_RESOURCE_TYPES in its network tool). The local schema must
   * accept exactly this enum.
   */
  const NETWORK_RESOURCE_TYPES = z.enum([
    "document",
    "stylesheet",
    "image",
    "media",
    "font",
    "script",
    "texttrack",
    "xhr",
    "fetch",
    "prefetch",
    "eventsource",
    "websocket",
    "manifest",
    "signedexchange",
    "ping",
    "cspviolationreport",
    "preflight",
    "fedcm",
  ])
  /**
   * Console message types the pinned chrome-devtools-mcp@1.8.0 bridge accepts
   * (FILTERABLE_MESSAGE_TYPES in its console tool). The local schema must
   * accept exactly this enum: a value the bridge rejects would surface only at
   * dispatch, after approval.
   */
  const CONSOLE_MESSAGE_TYPES = z.enum([
    "log",
    "debug",
    "info",
    "error",
    "warn",
    "dir",
    "dirxml",
    "table",
    "trace",
    "clear",
    "startGroup",
    "startGroupCollapsed",
    "endGroup",
    "assert",
    "profile",
    "profileEnd",
    "count",
    "timeEnd",
    "verbose",
    "issue",
  ])
  /**
   * Appended to every bridge tool description so the agent knows the boundary
   * before it spends approvals on an ordinary site (ADR-169, tier T0). Used
   * verbatim when the read tier is off.
   */
  export const LIMITS_NOTE =
    "Limits: this bridge only lists and runs tools that a page registers itself through WebMCP. " +
    "It cannot read page text or the DOM, take screenshots, click, type, or run scripts. " +
    "If list_webmcp_tools reports none, use another tool such as webfetch to read the site."
  /**
   * T1 read-tier boundary note. Reading is limited to the three read tools from
   * the allowed origins; interaction stays impossible, so this never claims the
   * T0 sentence that reading is unavailable.
   */
  export const READ_LIMITS_NOTE =
    "Limits: read access is limited to four tools — page snapshot, screenshot, console messages, and request metadata (method/url/status/type) — for the allowed origins. " +
    "Interaction is still impossible: it cannot click, type, run scripts, upload files, or read network bodies. " +
    "Page-registered WebMCP tools remain the only operations it can run."
  /** The T0 note when the read tier is off, the read-tier note when it is on. */
  export function limitsNote(profile: Configuration): string {
    return profile.read === true ? READ_LIMITS_NOTE : LIMITS_NOTE
  }
  const tools = new Set<string>(TOOLS)
  const readTools = new Set<string>(READ_TOOLS)
  const readScopeTools = new Set<string>(READ_SCOPE_TOOLS)
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

  const Origin = z.string().max(240).refine(exactOrigin, "Use an exact HTTPS origin or HTTP loopback origin")
  const uniqueOrigins = (origins: string[]) => new Set(origins).size === origins.length
  const Origins = z.array(Origin).min(1).max(8).refine(uniqueOrigins, "Origins must be unique")
  /**
   * ADR-170: a profile origin list may be empty. Empty means navigation is
   * unrestricted (the product default); a non-empty list is a narrowing list
   * that restores exact-origin enforcement at launch and at call time.
   */
  const ProfileOrigins = z.array(Origin).max(8).refine(uniqueOrigins, "Origins must be unique")

  /**
   * ADR-170: a profile with a narrowing origin list enforces exact origins at
   * launch and at call time; an empty list navigates any http(s) origin and
   * the grant machinery stays dormant (no grant prompts, no relaunches).
   */
  export function restricted(profile: { allowedOrigins: readonly string[] }): boolean {
    return profile.allowedOrigins.length > 0
  }

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
        "Managed narrowing list. When set, only these exact origins stay usable: an unrestricted profile narrows to this list; a configured profile is intersected with it and an empty intersection fails closed.",
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
      allowRead: z
        .boolean()
        .optional()
        .describe(
          "Managed gate for the T1 read tier. Default off. false forces the read tools off even when the profile sets read: true; it can only restrict, never enable.",
        ),
    })
    .strict()
    .meta({ ref: "WebMcpRequirementConfig" })
  export type Requirement = z.infer<typeof Requirement>

  export const Configuration = z
    .object({
      allowedOrigins: ProfileOrigins.describe(
        "Exact permitted origins; no wildcards, credentials, paths, queries or fragments. Empty (the product default) navigates any http(s) origin; a non-empty list narrows navigation to exactly those origins.",
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
      read: z
        .boolean()
        .optional()
        .describe(
          "Enable the T1 read tier: page snapshot, screenshot and console tools for granted origins. Default off. A managed allowRead: false forces it off.",
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
  export type Policy = {
    server: string
    toolName: string
    profile: Configuration
    /**
     * Live read-grant set for this bridge connection (ADR-171), supplied at
     * tool conversion so dispatch checks current state rather than a stale
     * snapshot. Absent means no grants.
     */
    readGrants?: () => ReadonlySet<string>
  }

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
  export const VENDORED_VERSION = "1.8.0"
  export const VENDORED_REGISTRY_HOST = "registry.npmjs.org"

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
    // The integrity pin alone does not bind the version or the registry it
    // was resolved from; a lockfile that points elsewhere fails closed.
    if (entry.version !== VENDORED_VERSION) {
      return { ok: false, error: "WebMCP vendored install version does not match the reviewed pin" }
    }
    let resolved: URL | undefined
    try {
      resolved = typeof entry.resolved === "string" ? new URL(entry.resolved) : undefined
    } catch {
      resolved = undefined
    }
    if (resolved?.protocol !== "https:" || resolved.hostname !== VENDORED_REGISTRY_HOST) {
      return { ok: false, error: "WebMCP vendored install was not resolved from the pinned registry" }
    }
    return { ok: true }
  }

  // Rollup over every reviewed byte of chrome-devtools-mcp@1.8.0: the sha512
  // of the sorted `path:file-sha512` lines of the integrity-pinned tarball,
  // verified byte-identical against a real registry install.
  export const VENDORED_PACKAGE_HASH =
    "333e001fef885b4c77fe9aaecdcc8efc1bf904c6b8d7445ae8afbce529fd6440d4e83cd09c969674f015e4a66191b56829d6cabffb5763e7521b2ac11b7b91ab"

  /**
   * Verify the installed package bytes against the reviewed rollup. The
   * lockfile pins are public claims — anyone can write a matching lockfile —
   * so every launch re-hashes the extracted files. Dotfiles are skipped (OS
   * droppings, never required); anything else unexpected, missing, unreadable
   * or symlinked fails closed. Hoisted dependency siblings are outside this
   * check: they are fetched over the pinned https registry at install time
   * and are not re-verified here.
   */
  export function verifyVendoredPackage(
    prefixDir: string,
    expected = VENDORED_PACKAGE_HASH,
  ): { ok: true } | { ok: false; error: string } {
    const root = path.join(prefixDir, "node_modules", "chrome-devtools-mcp")
    const failed = { ok: false as const, error: "WebMCP vendored install failed byte verification" }
    const files: string[] = []
    const walk = (dir: string): boolean => {
      let entries
      try {
        entries = readdirSync(dir, { withFileTypes: true })
      } catch {
        return false
      }
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue
        const full = path.join(dir, entry.name)
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) return false
        if (entry.isDirectory()) {
          if (!walk(full)) return false
        } else {
          files.push(path.relative(root, full).split(path.sep).join("/"))
        }
      }
      return true
    }
    if (!walk(root)) return failed
    files.sort()
    const rollup = createHash("sha512")
    for (const rel of files) {
      let bytes: Buffer
      try {
        bytes = readFileSync(path.join(root, rel))
      } catch {
        return failed
      }
      rollup.update(`${rel}:${createHash("sha512").update(bytes).digest("hex")}\n`)
    }
    if (rollup.digest("hex") !== expected) return failed
    return { ok: true }
  }

  export function command(profile: Configuration, identity?: Configuration): string[] {
    return [
      // A vendored profile launches the integrity-pinned local install; the
      // default npx form resolves the same pinned version from the registry.
      ...(profile.vendored ? ["node", vendoredBin()] : ["npx", "-y", PACKAGE]),
      // A persistent profile holds real cookies, so it is always a dedicated
      // AX-owned directory with a visible window — never the user's main
      // profile and never headless. The directory key follows the configured
      // profile (identity), not the effective one: session grants and managed
      // narrowing change the launch argv but must not swap the login state out
      // from under the user.
      ...(profile.persistentProfile
        ? [`--user-data-dir=${profileDirectory(identity ?? profile)}`]
        : ["--isolated", ...(profile.headless ? ["--headless"] : [])]),
      "--no-usage-statistics",
      "--no-performance-crux",
      // ADR-172: only the network category flag comes off (list_network_requests
      // joins the read tier). Emulation and performance categories stay
      // blocked at the argv layer as defense in depth — the pinned package
      // has no per-tool exclusion flag, and allows() is the product gate.
      "--no-category-emulation",
      "--no-category-performance",
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

  /**
   * Validate a configured webmcp entry and return its frozen profile. The
   * stored command is never executed (ADR-173): the launch argv is always
   * regenerated from the effective profile at connect time, so version drift
   * self-heals and a hand-edited command cannot smuggle arguments — it is
   * discarded by construction. Semantics stay exactly f(profile): the schema
   * and the managed gates validate the profile, not the command.
   */
  export function validateLaunch(server: Server): Configuration | undefined {
    if (!server.webmcp) return undefined
    const profile = Configuration.parse(server.webmcp)
    if (server.type !== "local") {
      throw new Error("WebMCP requires a local launch command")
    }
    if (server.environment && Object.keys(server.environment).length > 0) {
      throw new Error("WebMCP profiles do not accept environment overrides.")
    }
    Object.freeze(profile.allowedOrigins)
    return Object.freeze(profile)
  }

  /**
   * Why a webmcp-profiled entry does not carry the reviewed launch argv for its
   * validated profile, or undefined when it does (ADR-173). The entry is then
   * trusted on an explicit connect; any other entry falls to the normal trust
   * gate, which says nothing about a drifted `command`, so name the difference.
   */
  export function argvMismatch(server: Server): string | undefined {
    if (server.type !== "local" || server.webmcp === undefined) return undefined
    let profile: Configuration | undefined
    try {
      profile = validateLaunch(server)
    } catch (error) {
      return `webmcp profile is invalid: ${error instanceof Error ? error.message : String(error)}`
    }
    if (!profile) return undefined
    const expected = command(profile)
    if (JSON.stringify(server.command) === JSON.stringify(expected)) return undefined
    const actual = server.command ?? []
    const extra = actual.filter((arg) => !expected.includes(arg))
    const missing = expected.filter((arg) => !actual.includes(arg))
    const parts = [
      ...(extra.length > 0 ? [`extra ${extra.join(" ")}`] : []),
      ...(missing.length > 0 ? [`missing ${missing.join(" ")}`] : []),
    ]
    const detail = parts.length > 0 ? parts.join("; ") : "argument order differs"
    return `command differs from its webmcp profile (${detail})`
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
   * Managed read gate. `allowRead: false` forces the T1 read tier off even
   * when the profile opted in; the profile can never re-enable it. Returns the
   * same frozen profile object when read is already off, so an absent or false
   * `read` stays byte-for-byte unchanged.
   */
  function withoutRead(profile: Configuration): Configuration {
    if (profile.read !== true) return profile
    const { read: _read, ...rest } = profile
    const effective = Configuration.parse(rest)
    Object.freeze(effective.allowedOrigins)
    return Object.freeze(effective)
  }

  /**
   * Evaluate a managed requirement against a launch-validated profile. A deny or
   * a narrowing that admits no origin fails closed with a reason the caller can
   * surface as a distinct blocked state; a partial narrowing only makes the
   * call-time origin check stricter than the browser allowlist. A persistent
   * profile requires the managed `allowPersistentProfile` opt-in. A managed
   * `allowRead: false` forces the read tier off without blocking the bridge.
   */
  export function evaluate(requirement: Requirement | undefined, profile: Configuration): PolicyDecision {
    if (requirement && requirement.allow === false) return { ok: false, reason: "managed_policy" }
    if (profile.persistentProfile === true && requirement?.allowPersistentProfile !== true) {
      return { ok: false, reason: "persistent_profile" }
    }
    if (profile.vendored === true && requirement?.allowVendored !== true) {
      return { ok: false, reason: "vendored" }
    }
    const gated = requirement?.allowRead === false ? withoutRead(profile) : profile
    if (!requirement) return { ok: true, profile: gated }
    const allowed = requirement.allowedOrigins
    if (!allowed) return { ok: true, profile: gated }
    // ADR-170: an unrestricted profile (no configured origins) narrows to the
    // managed list outright; the intersection rule below applies only when the
    // profile itself carries a narrowing list.
    if (gated.allowedOrigins.length === 0) {
      const narrowed = Configuration.parse({ ...gated, allowedOrigins: allowed })
      Object.freeze(narrowed.allowedOrigins)
      return { ok: true, profile: Object.freeze(narrowed) }
    }
    const admitted = gated.allowedOrigins.filter((origin) => allowed.includes(origin))
    if (admitted.length === 0) return { ok: false, reason: "managed_origins" }
    if (admitted.length === gated.allowedOrigins.length) return { ok: true, profile: gated }
    const narrowed = Configuration.parse({ ...gated, allowedOrigins: admitted })
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

  /**
   * A well-formed HTTPS (or loopback HTTP) origin that is outside the effective
   * allowlist. The message matches the historical hard error; callers that can
   * prompt (ADR-168) catch this type, everyone else sees an ordinary failure.
   */
  export class OriginNotGrantedError extends Error {
    constructor(readonly origin: string) {
      super("WebMCP navigation origin is not allowed")
      this.name = "OriginNotGrantedError"
    }
  }

  /**
   * A read-tier call against an origin with no session read grant (ADR-171).
   * The dispatch throws it before the bridge is ever called; the caller that
   * can prompt catches it, records the grant, and asks the model to retry.
   * Unlike an origin grant, a read grant is app-layer only and never relaunches
   * the browser.
   */
  export class ReadNotGrantedError extends Error {
    constructor(readonly origin: string) {
      super("WebMCP read access to this origin is not granted")
      this.name = "ReadNotGrantedError"
    }
  }

  /** Configured profile plus session-granted origins; frozen like a launch-validated profile. */
  export function withGrants(profile: Configuration, granted: readonly string[]): Configuration {
    const extra = granted.filter((origin) => !profile.allowedOrigins.includes(origin))
    if (extra.length === 0) return profile
    const allowedOrigins = [...profile.allowedOrigins, ...extra]
    if (allowedOrigins.length > 8) {
      // checkGrant caps grants at apply time; a mid-session config edit can
      // still push the union past the schema cap. Fail with a readable error
      // instead of a raw ZodError from Configuration.parse.
      throw new Error("WebMCP configured and granted origins exceed the maximum of 8")
    }
    const effective = Configuration.parse({ ...profile, allowedOrigins })
    Object.freeze(effective.allowedOrigins)
    return Object.freeze(effective)
  }

  /**
   * The apex/`www` twin of an HTTPS origin (`https://a.test` <-> `https://www.a.test`),
   * so one prompt can cover a site that redirects between them. Only a default-port
   * HTTPS hostname with a registrable-looking name qualifies; IPs, loopback, other
   * ports, and single-label hosts have no twin. Exact origin only, no wildcard.
   */
  export function counterpartOrigin(origin: string): string | undefined {
    try {
      const url = new URL(origin)
      if (url.protocol !== "https:" || url.port || url.origin !== origin) return undefined
      const host = url.hostname
      if (host.includes(":") || /^[\d.]+$/.test(host)) return undefined
      const bare = host.startsWith("www.") ? host.slice(4) : host
      if (!bare.includes(".")) return undefined
      return `https://${host.startsWith("www.") ? bare : `www.${host}`}`
    } catch {
      return undefined
    }
  }

  export type GrantDecision = { ok: true } | { ok: false; error: string }

  /**
   * Decide whether a session origin grant may even be offered. The managed
   * requirement is a ceiling: a grant is refused, without a prompt, when managed
   * policy denies the bridge or does not list the origin. The 8-origin schema
   * cap applies to configured plus granted origins together.
   */
  export function checkGrant(
    requirement: Requirement | undefined,
    profile: Configuration,
    granted: readonly string[],
    origin: string,
  ): GrantDecision {
    if (!exactOrigin(origin))
      return { ok: false, error: "WebMCP origin must be an exact HTTPS or loopback HTTP origin" }
    if (requirement?.allow === false) return { ok: false, error: blockedMessage("managed_policy") }
    // Grants extend a configured narrowing list (ADR-168). An unrestricted
    // profile (ADR-170) has none — including one narrowed by a managed list,
    // whose effective allowlist is already exactly that list — so a grant has
    // nothing to extend and a stale grant must not restrict the profile.
    if (!restricted(profile)) {
      return { ok: false, error: "WebMCP navigation is unrestricted for this bridge; no origin grant applies" }
    }
    if (requirement?.allowedOrigins && !requirement.allowedOrigins.includes(origin)) {
      return { ok: false, error: "WebMCP managed policy does not allow this origin" }
    }
    // Merge by set so an over-cap union (a config edit while grants exist)
    // reports a decision instead of throwing from withGrants' schema parse.
    const current = new Set([...profile.allowedOrigins, ...granted])
    if (current.has(origin)) return { ok: true }
    if (current.size >= 8) {
      return { ok: false, error: "WebMCP already has the maximum of 8 allowed origins" }
    }
    return { ok: true }
  }

  /**
   * Decide whether a session read grant may be offered for an origin (ADR-171).
   * The managed requirement is re-evaluated as the ceiling, the effective
   * profile must have the read tier on, and a narrowing list bounds the origin.
   * An unrestricted profile may grant any well-formed origin: the prompt is the
   * control. Grants are per origin, capped, and refused without prompting on a
   * policy failure.
   */
  export function checkReadGrant(
    requirement: Requirement | undefined,
    profile: Configuration,
    granted: ReadonlySet<string>,
    origin: string,
  ): GrantDecision {
    if (!exactOrigin(origin))
      return { ok: false, error: "WebMCP origin must be an exact HTTPS or loopback HTTP origin" }
    const decision = evaluate(requirement, profile)
    if (!decision.ok) return { ok: false, error: blockedMessage(decision.reason) }
    if (decision.profile.read !== true) {
      return { ok: false, error: "WebMCP read tier is not enabled for this bridge" }
    }
    if (restricted(decision.profile) && !decision.profile.allowedOrigins.includes(origin)) {
      return { ok: false, error: "WebMCP origin is outside this bridge's narrowing list" }
    }
    if (granted.has(origin)) return { ok: true }
    if (granted.size >= 8) return { ok: false, error: "WebMCP already has the maximum of 8 read grants" }
    return { ok: true }
  }

  /**
   * The exact origin of a URL that could ever be granted: HTTPS, or HTTP on
   * loopback, with no credentials. Anything else (other schemes, `blob:`,
   * credentials, malformed) returns undefined. Mirrors the shape rule in
   * `checkGrant`, so a caller that must offer a grant never offers a
   * non-grantable target. Used by the redirect probe to classify hops.
   */
  export function grantableOrigin(value: string): string | undefined {
    try {
      const url = new URL(value)
      if (url.username || url.password) return undefined
      if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback.has(url.hostname))) return undefined
      return url.origin
    } catch {
      return undefined
    }
  }

  /**
   * Whether the bridge admits a tool. The six T0 tools are always admitted.
   * The read-scope tools (ADR-171/172) are admitted only when the effective
   * profile opted into the read tier (`read: true`); every other upstream
   * tool is rejected. This is the product admission gate; the argv keeps the
   * emulation and performance categories off as defense in depth.
   */
  export function allows(name: string, profile?: Configuration): boolean {
    if (tools.has(name)) return true
    return profile?.read === true && readScopeTools.has(name)
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
    // T1 read tools. Strict schemas: no extra keys, and no `filePath` anywhere,
    // because the upstream take_screenshot/take_snapshot would otherwise write
    // the page content to disk. `fullPage` is excluded for the same reason:
    // the pinned upstream auto-saves any screenshot of 2 MB or more to a temp
    // file even without filePath, and a full-page capture of a long page is
    // the common way past that threshold. A viewport capture can still cross
    // it on large displays, so slice B must intercept "Saved screenshot to"
    // responses instead of relying on this schema alone. `uid` and `fullPage`
    // are also mutually exclusive upstream, so dropping fullPage removes that
    // rejected combination too.
    take_snapshot: z.object({ pageId, verbose: z.boolean().optional() }).strict(),
    take_screenshot: z
      .object({
        pageId,
        format: z.enum(["png", "jpeg", "webp"]).optional(),
        quality: z.number().int().min(0).max(100).optional(),
        uid: z.string().max(128).optional(),
      })
      .strict(),
    list_console_messages: z
      .object({
        pageId,
        pageSize: z.number().int().min(1).max(50).optional(),
        pageIdx: z.number().int().min(0).optional(),
        // Mirrors the pinned upstream's FILTERABLE_MESSAGE_TYPES enum; the
        // advertised schema must not accept strings the bridge then rejects.
        types: z.array(CONSOLE_MESSAGE_TYPES).max(8).optional(),
      })
      .strict(),
    // ADR-172: read-only network metadata (method/url/status/type). No
    // includePreservedRequests — the preserved set spans navigations and
    // would leak the previous origin's URLs into a granted origin's result.
    list_network_requests: z
      .object({
        pageId,
        pageSize: z.number().int().min(1).max(100).optional(),
        pageIdx: z.number().int().min(0).max(20).optional(),
        resourceTypes: z.array(NETWORK_RESOURCE_TYPES).max(18).optional(),
      })
      .strict(),
  }

  export function callSchema(name: string, profile?: Configuration) {
    if (!allows(name, profile)) throw new Error("Tool is not admitted by the WebMCP bridge profile")
    return schemas[name as keyof typeof schemas]
  }

  export function validateCall(profile: Configuration, name: string, args: unknown): Record<string, unknown> {
    const parsed = callSchema(name, profile).safeParse(args)
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
      // blob: and other non-web schemes inherit or fake a web origin, so an
      // origin match alone would admit non-page targets.
      if (target.protocol !== "https:" && !(target.protocol === "http:" && loopback.has(target.hostname))) {
        throw new Error("WebMCP navigation requires an https: URL or an http: loopback URL")
      }
      if (target.username || target.password) throw new Error("WebMCP navigation origin is not allowed")
      // A well-formed origin that is merely absent from a narrowing list is
      // grantable by an interactive, session-scoped approval (ADR-168). An
      // unrestricted profile (no narrowing list, ADR-170) never prompts. Every
      // other rejection above stays a plain, non-grantable error.
      if (restricted(profile) && !profile.allowedOrigins.includes(target.origin)) {
        throw new OriginNotGrantedError(target.origin)
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
    // A page id alone tells the approver nothing about where the page tool
    // runs. Show the origin recorded when the page was listed; the
    // execute-time binding re-verifies it before running. A T1 read tool names
    // its page through the required pageId instead of a `toolName`. Only label
    // the tier when the effective profile has it enabled, so a read-off profile
    // never emits a read label.
    const isRead = readTools.has(tool) && profile.read === true
    const listedOrigin =
      typeof call.pageId === "number" && (isRead || typeof call.toolName === "string")
        ? listedOriginFor(profile, call.pageId)
        : undefined
    return {
      server,
      tool,
      allowedOrigins: [...profile.allowedOrigins],
      ...(typeof call.pageId === "number" ? { pageId: call.pageId } : {}),
      ...(typeof call.toolName === "string" ? { toolName: call.toolName } : {}),
      ...(listedOrigin ? { pageOrigin: listedOrigin } : {}),
      ...(typeof call.url === "string" ? { origin: new URL(call.url).origin } : {}),
      ...(typeof call.input === "string" ? { inputBytes: Buffer.byteLength(call.input, "utf8") } : {}),
      // Marks a T1 read call so the approval screen can label it as reading
      // page content from the listed origin.
      ...(isRead ? { readTier: true } : {}),
      // Page annotations describe a page tool, so they only belong on an
      // execute call that names one. Attaching them to bridge operations
      // would let a page tool named e.g. `close_page` forge the approval
      // hints for the real bridge operation.
      ...(annotations && typeof call.toolName === "string"
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

  const MAX_READ_TEXT_BYTES = 32 * 1024
  const CONSOLE_TAIL = 50

  /**
   * Secret-like query keys redacted from network/console URLs; ordinary query
   * strings stay (signed CDN URLs must remain downloadable). Userinfo and
   * fragments never leave the bridge (ADR-172).
   */
  const SECRET_QUERY_KEY =
    /([?&](?:token|access_token|auth|sig|signature|session|secret|password|passwd|api_key|apikey|credential|key)=)[^&\s]*/gi

  function redactUrlText(text: string): string {
    return text
      .replace(/:\/\/[^\s/]*@/g, "://")
      .replace(/(https?:\/\/[^\s#]+)#[^\s]*/g, "$1")
      .replace(SECRET_QUERY_KEY, "$1[redacted]")
  }

  /**
   * Bound and label a read-tier result (ADR-171, extended by ADR-172).
   * Page-derived output is untrusted: the origin is labeled on the content,
   * snapshot text and the network list over the 32 KiB budget are rejected
   * with narrowing guidance (reject over truncate), console output keeps only
   * the last 50 messages, network/console URLs lose userinfo, fragments and
   * secret-like query keys, and the upstream "Saved screenshot to <path>"
   * auto-save response fails closed — the path must never enter the log or
   * the model context.
   */
  export function boundReadResult(name: string, result: unknown, origin: string): void {
    if (!isRecord(result)) return
    const contents = Array.isArray(result.content) ? result.content : []
    const redactUrls = name === "list_network_requests" || name === "list_console_messages"
    let textBytes = 0
    for (const part of contents) {
      if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") continue
      if (part.text.startsWith("Saved screenshot to ")) {
        throw new Error(
          "WebMCP screenshot exceeded the inline budget and the bridge wrote it to a temporary file; do not read the file. Narrow the target (use uid) or lower the jpeg quality and retry.",
        )
      }
      let text = part.text
      if (redactUrls) {
        text = redactUrlText(text)
        part.text = text
      }
      textBytes += Buffer.byteLength(text, "utf8")
    }
    if ((name === "take_snapshot" || name === "list_network_requests") && textBytes > MAX_READ_TEXT_BYTES) {
      throw new Error(
        `WebMCP ${name === "take_snapshot" ? "snapshot" : "network list"} exceeded the ${MAX_READ_TEXT_BYTES / 1024} KiB read budget; narrow the request and retry`,
      )
    }
    if (name === "list_console_messages") {
      for (const part of contents) {
        if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") continue
        const lines = part.text.split("\n")
        if (lines.length > CONSOLE_TAIL) {
          part.text = [
            `... ${lines.length - CONSOLE_TAIL} earlier console messages omitted`,
            ...lines.slice(-CONSOLE_TAIL),
          ].join("\n")
        }
      }
      const structured = isRecord(result.structuredContent) ? result.structuredContent : undefined
      if (structured && Array.isArray(structured.messages) && structured.messages.length > CONSOLE_TAIL) {
        structured.messages = structured.messages.slice(-CONSOLE_TAIL)
      }
      // The tail bounds the message count, not their size: one oversized line
      // would otherwise pass through whole.
      let tailBytes = 0
      for (const part of contents) {
        if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
          tailBytes += Buffer.byteLength(part.text, "utf8")
        }
      }
      if (tailBytes > MAX_READ_TEXT_BYTES) {
        throw new Error(
          `WebMCP console output exceeded the ${MAX_READ_TEXT_BYTES / 1024} KiB read budget; narrow the request and retry`,
        )
      }
    }
    contents.unshift({ type: "text", text: `[Untrusted web content from ${origin}]` })
    result.content = contents
  }

  function pageOrigin(pageUrl: string | undefined): string | undefined {
    if (!pageUrl) return undefined
    try {
      const url = new URL(pageUrl)
      if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
      // A credentialed landing URL (a redirect target or a page-side
      // navigation) must fail closed: `origin` drops userinfo, so checking
      // membership alone would silently admit what validateCall rejects at
      // request time.
      if (url.username || url.password) return undefined
      return url.origin
    } catch {
      return undefined
    }
  }

  /**
   * Explain why a page URL cannot be bound to an origin. The generic "could
   * not be located" wording hid the two cases a model can act on: the tab
   * crashed into a browser error page, or it left the list entirely.
   */
  export function unlocatedPageMessage(pageUrl: string | undefined, action: string): string {
    if (!pageUrl) {
      return `WebMCP page ${action}: it is not in the bridge page list (it may have closed or crashed). Call list_pages and use a current pageId, or open the page again.`
    }
    if (/^chrome-error:/i.test(pageUrl)) {
      return `WebMCP page ${action}: the tab is showing a browser error page (chrome-error), so the site failed to load or crashed. Navigate again or try a different URL; do not retry the same call.`
    }
    return `WebMCP page ${action}: the tab is on a non-web address, so it has no origin to bind to. Navigate it to an http(s) page first.`
  }

  /**
   * A blocking JavaScript dialog (alert/confirm/prompt) freezes the page for
   * every bridge call, and handle_dialog is not an admitted tool. Surface that
   * as a plain note so the model stops retrying list/execute against it.
   */
  export function annotateBlockingDialog(result: unknown): void {
    if (!isRecord(result) || !Array.isArray(result.content)) return
    const texts = result.content.flatMap((item) =>
      isRecord(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : [],
    )
    if (!texts.some((text) => /^#+\s*Open dialog\b/m.test(text))) return
    result.content = [
      ...result.content,
      {
        type: "text",
        text: "[AX Code] The page is blocked by a JavaScript dialog. handle_dialog is not available through this bridge, so the page cannot be listed, read or driven until the dialog closes. Report this blocker to the user, or navigate to a different URL; do not retry list_webmcp_tools or execute_webmcp_tool against this page.",
      },
    ]
  }

  /**
   * Origin of a page URL for read-tier preflight (ADR-171). Fail-closed: any
   * non-page, credentialed or unparseable URL yields undefined, and the caller
   * must not proceed.
   */
  export function pageOriginOf(pageUrl: string | undefined): string | undefined {
    return pageOrigin(pageUrl)
  }

  /**
   * Parse the bridge's structured page list into pageId -> URL. The
   * structured URL comes from the browser target (`page.url()`), not the
   * page-controlled title, so origin checks must use this — never the text
   * rendering. Returns undefined when the bridge returned no page list.
   */
  export function parseStructuredPages(result: unknown): Map<number, string> | undefined {
    const record = isRecord(result) ? result : {}
    const structured = isRecord(record.structuredContent) ? record.structuredContent : undefined
    if (!structured || !Array.isArray(structured.pages)) return undefined
    const pages = new Map<number, string>()
    for (const entry of structured.pages) {
      if (!isRecord(entry) || typeof entry.url !== "string") continue
      const id: unknown = entry.id
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0 || pages.has(id)) continue
      pages.set(id, entry.url)
    }
    return pages
  }

  /** URL of the bridge-selected page, if the result carries a structured page list. */
  export function structuredSelectedPageUrl(result: unknown): string | undefined {
    const record = isRecord(result) ? result : {}
    const structured = isRecord(record.structuredContent) ? record.structuredContent : undefined
    if (!structured || !Array.isArray(structured.pages)) return undefined
    for (const entry of structured.pages) {
      if (isRecord(entry) && entry.selected === true && typeof entry.url === "string") return entry.url
    }
    return undefined
  }

  /**
   * Verify a navigation landed on an allowed origin. The bridge reports the
   * requested URL in its success message, so a redirect (or a page-side
   * navigation) would otherwise pass as the approved destination. The pinned
   * bridge always returns the authoritative structured page list on these
   * calls; its absence fails closed.
   */
  export function validateLanding(
    profile: Configuration,
    toolName: string,
    call: Record<string, unknown>,
    result: unknown,
  ): void {
    if (toolName !== "new_page" && toolName !== "navigate_page") return
    // The bridge always selects the page it just created.
    const url =
      toolName === "new_page"
        ? structuredSelectedPageUrl(result)
        : parseStructuredPages(result)?.get(call.pageId as number)
    const origin = pageOrigin(url)
    if (!origin) {
      throw new Error("WebMCP navigation landing could not be verified; do not retry automatically")
    }
    // The landing origin must be one the user has allowed. A redirect between
    // two allowed origins is permitted: the redirect target was separately
    // granted through the same per-origin approval, so it is authorized. A
    // landing on an origin outside the effective allowlist is rejected here;
    // the dispatch probe (tool-conversion.ts) offers the grant prompt for a
    // redirect target the bridge blocked, so the retry can land on it. An
    // unrestricted profile (ADR-170) accepts any http(s) landing.
    if (restricted(profile) && !profile.allowedOrigins.includes(origin)) {
      throw new Error("WebMCP navigation did not land on an allowed origin; do not retry automatically")
    }
  }

  export const MAX_TOOLS = 50
  export const MAX_DESCRIPTOR_BYTES = 64 * 1024
  export const MAX_REGISTRATION_CHANGES = 10
  const PAGE_LINE = /^(\d+):\s+(.*)$/
  const PAGE_URL = /\((https?:\/\/[^)\s]+)\)/g

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
    origin: string | undefined
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
      const pageId = Number(match[1])
      // Bridge-assigned ids are small non-negative integers. Skip rows whose
      // id is not one instead of silently rounding or colliding, and keep the
      // first row when an id repeats.
      if (!Number.isSafeInteger(pageId) || pageId < 0 || pages.has(pageId)) continue
      // The bridge prints `ID: title (url) [flags]` and the title is page
      // controlled: it may itself contain URLs or parentheses. The bridge
      // appends the real address last, so read the last parenthesized URL —
      // never the first URL on the line, which a title can forge.
      let url: string | undefined
      for (const candidate of match[2].matchAll(PAGE_URL)) url = candidate[1]
      pages.set(pageId, url ?? match[2].trim())
    }
    return pages
  }

  function descriptorHash(descriptor: ToolDescriptor): string {
    // Annotations ride along: the approval screen shows the listed
    // readOnly/consequential hints, so a flip must break the binding even
    // when the name, description and schema hash the same.
    return createHash("sha256")
      .update(
        JSON.stringify([
          descriptor.name,
          descriptor.description ?? "",
          descriptor.inputSchema ?? null,
          descriptor.annotations ?? null,
        ]),
      )
      .digest("hex")
  }

  function descriptorBytes(descriptors: ToolDescriptor[]): number {
    return Buffer.byteLength(JSON.stringify(descriptors), "utf8")
  }

  function duplicateToolName(descriptors: ToolDescriptor[]): string | undefined {
    const seen = new Set<string>()
    for (const descriptor of descriptors) {
      if (seen.has(descriptor.name)) return descriptor.name
      seen.add(descriptor.name)
    }
    return undefined
  }

  /**
   * Shared listing caps for the model's listing and the execute-time
   * re-listing. Both are listings; a page that exceeds the caps in either
   * path is not in an approvable state.
   */
  function checkListingCaps(descriptors: ToolDescriptor[]): string | undefined {
    if (descriptors.length > MAX_TOOLS) {
      return `WebMCP page registers too many tools (${descriptors.length} > ${MAX_TOOLS})`
    }
    if (descriptorBytes(descriptors) > MAX_DESCRIPTOR_BYTES) {
      return "WebMCP tool descriptors exceed the descriptor size limit"
    }
    return undefined
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
  /**
   * Clear a page's executable baseline while keeping its churn accounting. A
   * failed listing must not leave stale tools or origins behind for a later
   * execute to bind against — but it also must not reset the definition
   * churn count or revive a disabled page.
   */
  function clearBaseline(state: ListingState, pageId: number): void {
    const existing = state.pages.get(pageId)
    if (!existing) return
    state.pages.set(pageId, {
      tools: new Map(),
      annotations: new Map(),
      changes: existing.changes,
      disabled: existing.disabled,
      origin: undefined,
    })
  }

  export function invalidateListing(profile: Configuration, pageId: number): void {
    clearBaseline(stateFor(profile), pageId)
  }

  export function recordListing(
    state: ListingState,
    pageId: number,
    descriptors: ToolDescriptor[],
    pageUrl?: string | undefined,
  ): ListingResult {
    const duplicate = duplicateToolName(descriptors)
    const error = duplicate
      ? `WebMCP page registers a duplicate tool name (${duplicate})`
      : checkListingCaps(descriptors)
    if (error) {
      clearBaseline(state, pageId)
      return { ok: false, error }
    }
    const origin = pageOrigin(pageUrl)
    if (!origin) {
      clearBaseline(state, pageId)
      return { ok: false, error: unlocatedPageMessage(pageUrl, "could not be located when its tools were listed") }
    }
    const tools = new Map<string, string>()
    const annotations = new Map<string, ToolDescriptor["annotations"]>()
    for (const descriptor of descriptors) {
      tools.set(descriptor.name, descriptorHash(descriptor))
      annotations.set(descriptor.name, descriptor.annotations)
    }
    const existing = state.pages.get(pageId)
    // A navigation counts as a page change just like a definition change.
    const same = existing && sameTools(existing.tools, tools) && existing.origin === origin
    const changes = existing && !same ? existing.changes + 1 : (existing?.changes ?? 0)
    if (changes > MAX_REGISTRATION_CHANGES) {
      state.pages.set(pageId, { tools, annotations, changes, disabled: true, origin })
      return { ok: false, error: "WebMCP tool definitions changed too many times on this page" }
    }
    state.pages.set(pageId, { tools, annotations, changes, disabled: false, origin })
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

  /** Listing-time origin for a page, when the model already listed it. */
  export function listedOriginFor(profile: Configuration, pageId: number): string | undefined {
    const page = listingStates.get(profile)?.pages.get(pageId)
    if (!page || page.disabled) return undefined
    return page.origin
  }

  /**
   * Immutable approval-time binding for one `execute_webmcp_tool` call. The
   * listing baseline is connection-wide mutable state shared across sessions,
   * so the origin and descriptor hash the approver saw are captured when the
   * approval is requested and the dispatch-time preflight verifies the fresh
   * listing against this snapshot instead of the live baseline. A baseline
   * rewrite between approval and dispatch then fails closed instead of
   * executing a definition the user never approved.
   */
  export type ApprovalSnapshot = { pageId: number; toolName: string; origin: string; hash: string }

  /** Capture the current baseline for a tool, if the page has a usable listing. */
  export function captureApproval(
    profile: Configuration,
    pageId: number,
    toolName: string,
  ): ApprovalSnapshot | undefined {
    const page = listingStates.get(profile)?.pages.get(pageId)
    if (!page || page.disabled || page.origin === undefined) return undefined
    const hash = page.tools.get(toolName)
    if (hash === undefined) return undefined
    return { pageId, toolName, origin: page.origin, hash }
  }

  const approvals = new WeakMap<object, ApprovalSnapshot>()

  /** Bind a snapshot to the validated call object that carries it to dispatch. */
  export function bindApproval(call: object, snapshot: ApprovalSnapshot): void {
    approvals.set(call, snapshot)
  }

  /** Snapshot bound to a dispatch-time call object, if the approval captured one. */
  export function approvalFor(args: unknown): ApprovalSnapshot | undefined {
    if (typeof args !== "object" || args === null) return undefined
    return approvals.get(args)
  }

  const denied = new WeakSet<object>()

  /**
   * Mark a call object whose approval found no listing. Dispatch still asks
   * first (an unlisted execute surfaces its warning-laden approval dialog),
   * but the marked call can never fall back to a baseline another session
   * writes while approval is pending: it fails instead of executing a
   * definition the approver never saw.
   */
  export function denyApproval(call: object): void {
    denied.add(call)
  }

  /** Whether the approval for a dispatch-time call object found no listing. */
  export function approvalDenied(args: unknown): boolean {
    return typeof args === "object" && args !== null && denied.has(args)
  }

  /**
   * Verify a fresh listing still matches what the model saw. `pageUrl` is the
   * page's current URL from a fresh `list_pages`; a missing page or an origin
   * that left the allowlist fails closed. When `expected` carries the
   * approval-time snapshot, the fresh listing is compared against it instead
   * of the live baseline, so a post-approval baseline rewrite fails closed.
   */
  export function verifyBinding(
    profile: Configuration,
    pageId: number,
    toolName: string,
    descriptors: ToolDescriptor[],
    pageUrl?: string,
    expected?: ApprovalSnapshot,
  ): ListingResult {
    const page = listingStates.get(profile)?.pages.get(pageId)
    if (page?.disabled) return { ok: false, error: "WebMCP tool definitions are disabled for this page" }
    // A cleared baseline (failed listing) is equivalent to never having
    // listed for live-bound execution: the churn accounting stays on the
    // retained entry, but nothing may execute against it. A snapshot-bound
    // call still verifies the fresh listing against its approval below.
    const cleared = !page || page.origin === undefined
    if (cleared && !expected) {
      return { ok: false, error: "WebMCP execute requires list_webmcp_tools to be called first" }
    }
    // The re-listing is a listing too: an over-cap or ambiguous fresh
    // listing is not an approvable page state even when the one approved
    // tool still hashes the same.
    const duplicate = duplicateToolName(descriptors)
    if (duplicate) return { ok: false, error: `WebMCP re-listing registers a duplicate tool name (${duplicate})` }
    const capped = checkListingCaps(descriptors)
    if (capped) return { ok: false, error: capped }
    const origin = pageOrigin(pageUrl)
    if (!origin) return { ok: false, error: unlocatedPageMessage(pageUrl, "could not be located before execution") }
    if (expected) {
      if (expected.pageId !== pageId || expected.toolName !== toolName) {
        return { ok: false, error: "WebMCP approval does not match this call; refusing to execute" }
      }
      if (origin !== expected.origin) {
        return { ok: false, error: "WebMCP page origin changed since approval; list its tools again before executing" }
      }
      if (restricted(profile) && !profile.allowedOrigins.includes(origin)) {
        return { ok: false, error: "WebMCP page origin is no longer allowed" }
      }
      const fresh = descriptors.find((descriptor) => descriptor.name === toolName)
      if (!fresh) return { ok: false, error: `WebMCP tool ${toolName} is no longer registered` }
      if (descriptorHash(fresh) !== expected.hash) {
        return { ok: false, error: `WebMCP tool ${toolName} definition changed since approval` }
      }
      return { ok: true }
    }
    if (cleared || !page) {
      return { ok: false, error: "WebMCP execute requires list_webmcp_tools to be called first" }
    }
    // The execute-time origin must equal the listing-time origin: an
    // allowlist match alone would let two same-allowlist origins swap under
    // a mirrored tool definition.
    if (origin !== page.origin) {
      return { ok: false, error: "WebMCP page origin changed since its tools were listed" }
    }
    if (restricted(profile) && !profile.allowedOrigins.includes(origin)) {
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

  const CHROME_VERSION = /^(?:Google Chrome(?: for Testing)?|Chromium)\s+(\d+)\./

  /** Parse the major version from `chrome --version` output. */
  export function chromeMajor(version: string): number | undefined {
    // Any `digits-dot` prefix is not a Chrome version: another product's
    // output (or an unparseable number) must not pass the version floor.
    const match = CHROME_VERSION.exec(version.trim())
    if (!match) return undefined
    const major = Number(match[1])
    return Number.isSafeInteger(major) ? major : undefined
  }

  const execFileAsync = promisify(execFile)

  /**
   * Fail-closed preflight for an explicit Chrome executable. The pinned bridge
   * needs Chrome 150+ for the WebMCP surface; a stale or non-Chrome binary must
   * be rejected before a browser is launched. Best-effort by nature: the binary
   * could still be swapped between this check and the bridge launch, so this
   * only rejects stale or non-Chrome binaries, it does not authenticate them.
   */
  export async function verifyChromeVersion(
    executablePath: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    let output: string
    try {
      // Async so a hung executable cannot stall the event loop for the timeout.
      ;({ stdout: output } = await execFileAsync(executablePath, ["--version"], {
        encoding: "utf8",
        timeout: 10_000,
      }))
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
