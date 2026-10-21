import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { Ajv } from "@modelcontextprotocol/client/validators/ajv"
import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { Instance } from "../project/instance"
import { Session } from "../session"
import { SessionMove } from "../session/move"
import { SessionID } from "../session/schema"
import { Config } from "../config/config"
import { exactOrigin } from "./webmcp-origin"
import { WebMcpProfile } from "./webmcp-profile"
import { parseJsonStrict } from "../util/json-value"
import { BrowserRouting } from "./browser-routing"
import { Filesystem } from "../util/filesystem"
import { NotFoundError } from "../storage/db"

// Captured from the trusted launcher once, never from project configuration.
const hostToken = process.env.AX_CODE_DESKTOP_BROWSER_TOKEN

export namespace DesktopBrowser {
  export const CAPABILITY = "desktop.webmcp.v1"
  export const HEADER = "x-ax-desktop-browser-token"
  // Closed set from ADR-266. `message` stays the human sentence NamedError promotes to
  // Error.message; `reason` is the stable code and `nextAction` is the single next step.
  // Unknown failures map to native-failure. Every construction goes through `failure`.
  export const Reasons = [
    "no-page",
    "page-changed",
    "tool-not-found",
    "definition-changed",
    "invalid-input",
    "provider-gone",
    "timeout",
    "session-rejected",
    "native-failure",
  ] as const
  export type Reason = (typeof Reasons)[number]
  export const Failure = NamedError.create(
    "DesktopBrowserUnavailable",
    z.object({
      reason: z.enum(Reasons),
      message: z.string(),
      nextAction: z.string(),
      path: z.string().optional(),
    }),
  )
  type FailureExtra = { reason?: Reason; nextAction?: string; path?: string }
  function failure(message: string, extra?: FailureExtra) {
    const classified = classify(message)
    const path = extra?.path
    return new Failure({
      reason: extra?.reason ?? classified.reason,
      message,
      nextAction: extra?.nextAction ?? classified.nextAction,
      ...(path ? { path } : {}),
    })
  }
  function fail(message: string, extra?: FailureExtra): never {
    throw failure(message, extra)
  }
  function classify(message: string): { reason: Reason; nextAction: string } {
    if (
      message.includes("is not a valid URL") ||
      message.startsWith("Only https://") ||
      message === "Credentials in a URL are not accepted" ||
      message === "Input must be a JSON object of at most 64 KiB" ||
      message === "Text of at most 2000 characters is required" ||
      message === "Credential fields are not accepted in agent input" ||
      message === "Enter credentials manually in the browser" ||
      message === "Enter credentials and payment details manually in the browser" ||
      message.startsWith("There is no element ") ||
      message.includes(" is disabled") ||
      message.includes(" is not a selector") ||
      message.startsWith("Input does not match the tool schema")
    ) {
      if (message.startsWith("Input does not match the tool schema"))
        return {
          reason: "invalid-input",
          nextAction: "Fix the input at the reported path so it matches the tool schema, then invoke again.",
        }
      if (message === "Credential fields are not accepted in agent input" || message.startsWith("Enter credentials"))
        return {
          reason: "invalid-input",
          nextAction: "Ask the user to enter credentials in the browser; do not type them.",
        }
      if (message.startsWith("There is no element ") || message.includes(" is disabled") || message.includes(" is not a selector"))
        return { reason: "invalid-input", nextAction: "Read the page again and use a ref from that outline." }
      if (message.includes("URL") || message.startsWith("Only https://") || message === "Credentials in a URL are not accepted")
        return {
          reason: "invalid-input",
          nextAction: "Pass an https:// URL, or http:// on loopback, with no credentials in the URL.",
        }
      return { reason: "invalid-input", nextAction: "Correct the arguments and call the tool again." }
    }
    if (message.startsWith("The project browser is enrolled but no page"))
      return { reason: "no-page", nextAction: "Call action=navigate with the https:// or loopback http:// URL to open." }
    if (
      message === "Browser document changed; authorize a fresh operation" ||
      message.startsWith("The project browser landed on a different origin") ||
      message === "Element references are stale; read the page again" ||
      message === "Response belongs to an expired browser request" ||
      message === "Browser connection or document changed; completion is unconfirmed"
    )
      return { reason: "page-changed", nextAction: "List again: the page changed." }
    if (message.startsWith("Tool was not in the latest listing"))
      return { reason: "tool-not-found", nextAction: "List tools, then invoke a toolName from that listing." }
    if (message === "Tool definition changed; list tools and authorize again" || message === "Tool catalog changed during listing")
      return {
        reason: "definition-changed",
        nextAction: "List again, then invoke with the toolName and digest from that listing.",
      }
    if (
      message.startsWith("No project browser is enrolled") ||
      message.startsWith("The project browser is disconnected") ||
      message === "Desktop browser provider is not enabled by the launcher" ||
      message === "Provider stream closed"
    )
      return {
        reason: "provider-gone",
        nextAction: "Ask the user to enable agent access in the project browser pane.",
      }
    if (message === "Browser request was aborted" || message === "Browser request canceled or timed out; completion is unconfirmed")
      return {
        reason: "timeout",
        nextAction: "Do not retry automatically; list again only if the user asks you to continue.",
      }
    if (message === "No coding session exists for this browser enrollment")
      return {
        reason: "session-rejected",
        nextAction: "Enroll with a session from this project; the supplied session does not exist.",
      }
    if (message === "Session belongs to another project")
      return {
        reason: "session-rejected",
        nextAction: "Enroll with a session whose directory is inside this project; the supplied session is not.",
      }
    return { reason: "native-failure", nextAction: "Stop and report the failure; do not retry automatically." }
  }
  export const ID = z.string().uuid()
  export const ToolDefinition = z
    .object({
      name: z.string().min(1).max(256),
      description: z.string().max(4096),
      inputSchema: z.record(z.string(), z.unknown()).optional(),
      annotations: z.record(z.string(), z.unknown()).optional(),
      frameId: z.string().min(1).max(256),
    })
    .strict()
    .refine((value) => bytes(value) <= 32768, "Tool definition exceeds 32 KiB")
    .meta({ ref: "DesktopWebMcpToolDefinition" })
  export const Snapshot = z
    .object({
      generation: ID,
      origin: z.string().refine(exactOrigin).nullable(),
      frameId: z.string().max(256),
      tools: ToolDefinition.array().max(128),
    })
    .strict()
    .refine((value) => bytes(value) <= 262144, "Catalog exceeds 256 KiB")
    // canonical() refuses to serialize values nested deeper than 32; reject them at
    // parse time so admission (enroll/update) and use (digest/compare) agree.
    .refine((value) => withinTransportDepth(value), "JSON nesting exceeds the transport limit")
    .refine(
      (value) => new Set(value.tools.map((tool) => tool.name)).size === value.tools.length,
      "Duplicate tool names are ambiguous",
    )
    .refine(
      (value) =>
        value.tools.every((tool) => tool.frameId === value.frameId) &&
        (value.origin !== null || value.tools.length === 0),
      "Only tools in the enrolled top-level origin are admitted",
    )
    .meta({ ref: "DesktopWebMcpSnapshot" })
  export type Snapshot = z.infer<typeof Snapshot>
  export const Enrollment = z
    .object({ sessionID: SessionID.zod, snapshot: Snapshot })
    .strict()
    .meta({ ref: "DesktopWebMcpEnrollment" })
  export const Binding = z
    .object({
      providerID: ID,
      epoch: ID,
      projectID: z.string().min(1).max(256),
      sessionID: SessionID.zod,
      generation: ID,
      origin: z.string().refine(exactOrigin),
      frameId: z.string().min(1).max(256),
    })
    .strict()
    .meta({ ref: "DesktopWebMcpBinding" })
  export type Binding = z.infer<typeof Binding>
  export const BoundRequest = Binding.extend({
    requestID: ID,
    operation: z.enum(["list", "invoke", "read", "act", "wait"]),
    deadline: z.number().int(),
    toolName: z.string().max(256).optional(),
    // ADR-198 page interaction. `ref` is only meaningful for the read named by `readId`.
    readId: ID.optional(),
    ref: z
      .string()
      .regex(/^e[1-9][0-9]{0,3}$/)
      .optional(),
    how: z.enum(["click", "type", "select"]).optional(),
    text: z.string().max(2000).optional(),
    waitText: z.string().min(1).max(200).optional(),
    timeoutMs: z.number().int().min(100).max(10000).optional(),
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    input: z.record(z.string(), z.unknown()).optional(),
  })
    .strict()
    .meta({ ref: "DesktopWebMcpBoundRequest" })
  /**
   * Navigation is requested before any page can be granted (a blank pane has no
   * origin or frame), so it carries the identity and the target URL only. The
   * provider replies after the new document is granted and its snapshot pushed.
   */
  export const NavigateRequest = z
    .object({
      providerID: ID,
      epoch: ID,
      projectID: z.string().min(1).max(256),
      sessionID: SessionID.zod,
      generation: ID,
      origin: z.string().nullable(),
      frameId: z.string().max(256),
      requestID: ID,
      operation: z.literal("navigate"),
      deadline: z.number().int(),
      url: z.string().max(2048),
    })
    .strict()
    .meta({ ref: "DesktopWebMcpNavigateRequest" })
  export const OutlineEntry = z
    .object({
      ref: z.string().regex(/^e[1-9][0-9]{0,3}$/),
      kind: z.string().max(32),
      name: z.string().max(80),
      submit: z.boolean().optional(),
      disabled: z.boolean().optional(),
      href: z.string().max(200).optional(),
      value: z.string().max(100).optional(),
      options: z.string().max(60).array().max(20).optional(),
    })
    .strict()
  export type OutlineEntry = z.infer<typeof OutlineEntry>
  export const ReadOutput = z
    .object({
      readId: ID,
      title: z.string().max(200),
      text: z.string().max(8000),
      outline: OutlineEntry.array().max(150),
    })
    .strict()
    .meta({ ref: "DesktopWebMcpReadOutput" })
  export type ReadOutput = z.infer<typeof ReadOutput>
  export const Request = z
    .union([BoundRequest, NavigateRequest])
    .meta({ ref: "DesktopWebMcpRequest" })
  export type Request = z.infer<typeof Request>
  export const Reply = z
    .object({
      requestID: ID,
      generation: ID,
      status: z.enum(["Completed", "Canceled", "Error"]),
      snapshot: Snapshot.optional(),
      output: z.unknown().optional(),
    })
    .strict()
    .refine(
      (value) => bytes(value) <= (value.snapshot ? 262144 + 1024 : 65536 + 1024),
      "Reply exceeds the transport limit",
    )
    .meta({ ref: "DesktopWebMcpReply" })
  export type Reply = z.infer<typeof Reply>
  export const Poll = z
    .object({ request: Request.nullable(), canceled: ID.array().max(8) })
    .strict()
    .meta({ ref: "DesktopWebMcpPoll" })
  export const Connection = z
    .object({ providerID: ID, epoch: ID, projectID: z.string().min(1).max(256), capability: z.literal(CAPABILITY) })
    .strict()
    .meta({ ref: "DesktopWebMcpConnection" })

  // Ajv's compiled check. `errors` is read synchronously after a call.
  type InputValidator = ((data: unknown) => boolean) & {
    errors?: { instancePath?: string; keyword?: string; params?: Record<string, unknown> }[] | null
  }
  /** Compiled page-schema validators kept per provider. Evicts the oldest digest. */
  export const VALIDATOR_CACHE_LIMIT = 32
  type Pending = {
    request: Request
    resolve: (reply: Reply) => void
    reject: (error: Error) => void
    cleanup: () => void
  }
  type Provider = {
    id: string
    epoch: string
    sessionID: SessionID
    snapshot: Snapshot
    queue: Request[]
    canceled: string[]
    pending: Map<string, Pending>
    touched: number
    /** Compiled validators keyed by tool-definition digest. Cleared on catalog update. */
    validators: Map<string, InputValidator>
    /** The latest page read; element references from any other read are refused. */
    lastRead?: { readId: string; generation: string; refs: Map<string, OutlineEntry> }
    wake?: () => void
    polling: boolean
  }
  const state = Instance.state(
    () => new Map<string, Provider>(),
    async (providers) => {
      for (const provider of providers.values()) retire(provider, { reason: "provider-gone" })
      providers.clear()
    },
  )

  /**
   * Navigation targets: https anywhere, plus loopback http (the local dev server
   * case). Everything else — file:, data:, other schemes, non-loopback http — is
   * refused before any request reaches the shell, whose own allowlist is the
   * same shape.
   */
  export function navigableUrl(raw: string): URL {
    let target: URL
    try {
      target = new URL(raw.trim())
    } catch {
      return fail(`"${raw.slice(0, 200)}" is not a valid URL`)
    }
    const loopback = target.hostname === "127.0.0.1" || target.hostname === "localhost" || target.hostname === "[::1]"
    if (target.protocol !== "https:" && !(target.protocol === "http:" && loopback))
      return fail("Only https:// URLs, or http:// on loopback, can be opened in the project browser")
    if (target.username || target.password) return fail("Credentials in a URL are not accepted")
    return target
  }

  export function bytes(value: unknown) {
    try {
      return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8")
    } catch {
      return Number.POSITIVE_INFINITY
    }
  }
  function withinTransportDepth(value: unknown): boolean {
    const stack: [unknown, number][] = [[value, 0]]
    while (stack.length) {
      const [item, level] = stack.pop()!
      if (level > 32) return false
      if (Array.isArray(item)) {
        for (const child of item) stack.push([child, level + 1])
      } else if (item && typeof item === "object") {
        for (const child of Object.values(item)) stack.push([child, level + 1])
      }
    }
    return true
  }
  function canonical(value: unknown, depth = 0): string {
    if (depth > 32) return fail("JSON nesting exceeds the transport limit")
    if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(",")}]`
    if (value && typeof value === "object") {
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], depth + 1)}`)
        .join(",")}}`
    }
    return JSON.stringify(value) ?? "null"
  }
  export function digest(tool: z.infer<typeof ToolDefinition>) {
    return createHash("sha256").update(canonical(tool)).digest("hex")
  }
  export function enabled() {
    return (
      BrowserRouting.mode() === "embedded" && typeof hostToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(hostToken)
    )
  }
  export function hostAuthorized(value: string | undefined) {
    if (!enabled() || !value) return false
    const expected = Buffer.from(hostToken!)
    const actual = Buffer.from(value)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }
  function retire(provider: Provider, options?: { keepNavigate?: boolean; reason?: "page-changed" | "provider-gone" }) {
    const keepNavigate = options?.keepNavigate === true
    const reason = options?.reason ?? "page-changed"
    const nextAction =
      reason === "provider-gone"
        ? "Ask the user to enable agent access again; the previous operation was not confirmed."
        : "List again: the page changed, and the previous operation was not confirmed."
    for (const pending of [...provider.pending.values()]) {
      // A document change is the *result* a navigation request is waiting for, so
      // it must survive the retire that the new snapshot triggers. Any other
      // change still retires it (the navigate request was made against the old
      // page state).
      if (keepNavigate && (pending.request.operation === "navigate" || pending.request.operation === "act")) continue
      provider.canceled.push(pending.request.requestID)
      pending.cleanup()
      pending.reject(
        failure("Browser connection or document changed; completion is unconfirmed", { reason, nextAction }),
      )
    }
    provider.queue = keepNavigate
      ? provider.queue.filter((request) => request.operation === "navigate" || request.operation === "act")
      : []
    provider.canceled = provider.canceled.slice(-8)
    provider.wake?.()
  }
  function provider(id: string) {
    const found = state().get(id)
    if (!found || Date.now() - found.touched > 45000) {
      if (found) {
        retire(found, { reason: "provider-gone" })
        state().delete(id)
      }
      return fail(
        "The project browser is disconnected, for example because its window was hidden, minimized or closed. Ask the user to reopen the project browser and enable agent access again; do not retry automatically",
      )
    }
    return found
  }
  /**
   * The session must exist (Session.get, the same lookup as requireCurrentProjectSession),
   * belong to this project, and sit inside the project boundary SessionMove uses
   * (instance directory, worktree, sandboxes) after Filesystem.resolve. Another project,
   * a parent path, and a prefixed sibling are rejected. A moved subdirectory is accepted.
   */
  function ownsEnrollingDirectory(directory: string) {
    return SessionMove.directoryWithinProject(directory)
  }
  export async function enroll(input: z.infer<typeof Enrollment>) {
    if (!enabled()) return fail("Desktop browser provider is not enabled by the launcher")
    const info = await Session.get(input.sessionID).catch((error: unknown) => {
      if (NotFoundError.isInstance(error)) return undefined
      throw error
    })
    if (!info)
      return fail("No coding session exists for this browser enrollment", {
        reason: "session-rejected",
        nextAction: `Enroll with a session from this project; ${input.sessionID} does not exist.`,
      })
    if (info.projectID !== Instance.project.id || !(await ownsEnrollingDirectory(info.directory)))
      return fail("Session belongs to another project", {
        reason: "session-rejected",
        nextAction: `Enroll with a session whose directory is inside this project; ${input.sessionID} is not.`,
      })
    const policy = (await Config.get()).webmcp
    if (policy?.allow === false) return fail("WebMCP is disabled by managed policy")
    const providers = state()
    for (const old of providers.values()) {
      // Providers that stopped polling are only evicted lazily by provider(); sweep them here so
      // dead connections cannot fill the table and block every later enrollment.
      if (old.sessionID === input.sessionID || Date.now() - old.touched > 45000) {
        retire(old, { reason: "provider-gone" })
        providers.delete(old.id)
      }
    }
    if (providers.size >= 8) return fail("Desktop provider limit reached")
    const entry: Provider = {
      id: randomUUID(),
      epoch: randomUUID(),
      sessionID: input.sessionID,
      snapshot: Snapshot.parse(input.snapshot),
      queue: [],
      canceled: [],
      pending: new Map(),
      touched: Date.now(),
      validators: new Map(),
      polling: false,
    }
    providers.set(entry.id, entry)
    return { providerID: entry.id, epoch: entry.epoch, projectID: Instance.project.id, capability: CAPABILITY } as const
  }
  export function disconnect(id: string) {
    const entry = state().get(id)
    if (!entry) return
    retire(entry, { reason: "provider-gone" })
    state().delete(id)
  }
  export function update(id: string, snapshot: Snapshot) {
    const entry = provider(id)
    const next = Snapshot.parse(snapshot)
    // Element references belong to one document; a new generation retires them.
    if (next.generation !== entry.snapshot.generation) entry.lastRead = undefined
    // Catalog changes retire already-approved calls even within the same document,
    // except a navigation that is waiting for exactly this document.
    if (canonical(next) !== canonical(entry.snapshot)) retire(entry, { keepNavigate: true, reason: "page-changed" })
    entry.snapshot = next
    // A catalog update retires compiled validators even when a digest is reused.
    entry.validators.clear()
    entry.touched = Date.now()
  }
  export async function poll(id: string, signal: AbortSignal) {
    const entry = provider(id)
    if (entry.polling) return fail("A provider may only have one request stream")
    entry.polling = true
    entry.touched = Date.now()
    try {
      if (entry.queue.length === 0 && entry.canceled.length === 0 && !signal.aborted) {
        await new Promise<void>((resolve) => {
          const wake = () => {
            clearTimeout(timer)
            signal.removeEventListener("abort", wake)
            entry.wake = undefined
            resolve()
          }
          const timer = setTimeout(wake, 15000)
          entry.wake = wake
          signal.addEventListener("abort", wake, { once: true })
        })
      }
      if (signal.aborted || state().get(id) !== entry) return fail("Provider stream closed")
      entry.touched = Date.now()
      return { request: entry.queue.shift() ?? null, canceled: entry.canceled.splice(0, 8) }
    } finally {
      entry.polling = false
    }
  }
  export function respond(id: string, reply: Reply) {
    const entry = provider(id)
    const pending = entry.pending.get(reply.requestID)
    // A navigate request is bound to the page BEFORE the load, so only the pushed
    // snapshot (the document the shell actually ended up on) must match the reply.
    // An action may navigate too: it is bound to the page it was issued against, but its reply
    // reports the document it ended on.
    const generationMatches =
      pending?.request.operation === "navigate" || pending?.request.operation === "act"
        ? entry.snapshot.generation === reply.generation
        : pending?.request.generation === reply.generation && entry.snapshot.generation === reply.generation
    if (!pending || !generationMatches) {
      return fail("Response belongs to an expired browser request")
    }
    const result = Reply.parse(reply)
    pending.cleanup()
    if (result.status !== "Completed")
      pending.reject(failure("Native invocation did not confirm completion; do not retry automatically"))
    else pending.resolve(result)
  }
  /** The single browser enrolled for this session, whether or not a page is granted. */
  function enrolled(sessionID: SessionID) {
    const entries = [...state().values()].filter((entry) => entry.sessionID === sessionID)
    if (entries.length !== 1)
      return fail(
        "No project browser is enrolled for this coding session. Ask the user to enable agent access in the project browser pane; this tool cannot enable it",
      )
    return provider(entries[0]!.id)
  }

  export function forSession(sessionID: SessionID) {
    const entries = [...state().values()].filter((entry) => entry.sessionID === sessionID)
    if (entries.length !== 1)
      return fail(
        "No project browser is enrolled for this coding session. Ask the user to enable agent access in the project browser pane; this tool cannot enable it or open pages",
      )
    const entry = provider(entries[0]!.id)
    if (!entry.snapshot.origin || !entry.snapshot.frameId)
      return fail(
        "The project browser is enrolled but no page can be granted to the agent. Ask the user to open the exact https:// or loopback http:// URL in the project browser pane, or call this tool with action=navigate to open it in that pane",
      )
    return Binding.parse({
      providerID: entry.id,
      epoch: entry.epoch,
      projectID: Instance.project.id,
      sessionID,
      generation: entry.snapshot.generation,
      origin: entry.snapshot.origin,
      frameId: entry.snapshot.frameId,
    })
  }
  function bound(binding: Binding) {
    const entry = provider(binding.providerID)
    if (
      binding.projectID !== Instance.project.id ||
      entry.epoch !== binding.epoch ||
      entry.sessionID !== binding.sessionID ||
      entry.snapshot.generation !== binding.generation ||
      entry.snapshot.origin !== binding.origin ||
      entry.snapshot.frameId !== binding.frameId
    )
      return fail("Browser document changed; authorize a fresh operation")
    return entry
  }
  export async function checkPolicy(binding: Binding) {
    bound(binding)
    const policy = (await Config.get()).webmcp
    if (policy?.allow === false || (policy?.allowedOrigins && !policy.allowedOrigins.includes(binding.origin))) {
      return fail("The browser origin is excluded by managed WebMCP policy")
    }
    bound(binding)
  }
  async function checkPolicyForOrigin(rawOrigin: string) {
    const policy = (await Config.get()).webmcp
    if (policy?.allow === false) return fail("WebMCP is disabled by managed policy")
    if (policy?.allowedOrigins && !policy.allowedOrigins.includes(rawOrigin))
      return fail("The browser origin is excluded by managed WebMCP policy")
  }

  async function dispatch(
    binding: Binding,
    operation: "list" | "invoke" | "read" | "act" | "wait",
    signal: AbortSignal,
    extra: {
      toolName?: string
      digest?: string
      input?: Record<string, unknown>
      readId?: string
      ref?: string
      how?: "click" | "type" | "select"
      text?: string
      waitText?: string
      timeoutMs?: number
    } = {},
  ) {
    await checkPolicy(binding)
    if (signal.aborted) return fail("Browser request was aborted")
    const entry = bound(binding)
    // The catalog can change within the same document while the policy check was awaited.
    if (operation === "invoke") {
      const tool = entry.snapshot.tools.find((item) => item.name === extra.toolName)
      if (!tool) return fail("Tool was not in the latest listing; list tools and choose a listed name")
      if (digest(tool) !== extra.digest) return fail("Tool definition changed; list tools and authorize again")
    }
    if (entry.pending.size !== 0) return fail("Another browser invocation is in progress")
    return enqueue(
      entry,
      BoundRequest.parse({ ...binding, ...extra, requestID: randomUUID(), operation, deadline: Date.now() + 30000 }),
      signal,
    )
  }

  /** Queue one request for the provider stream and await its reply. */
  function enqueue(entry: Provider, request: Request, signal: AbortSignal) {
    return new Promise<Reply>((resolve, reject) => {
      const cancel = () => {
        cleanup()
        // Cancellations are delivered privately, never on the global event bus.
        entry.canceled.push(request.requestID)
        entry.canceled = entry.canceled.slice(-8)
        entry.wake?.()
        reject(failure("Browser request canceled or timed out; completion is unconfirmed"))
      }
      const timer = setTimeout(cancel, 30000)
      const cleanup = () => {
        clearTimeout(timer)
        signal.removeEventListener("abort", cancel)
        entry.pending.delete(request.requestID)
        entry.queue = entry.queue.filter((item) => item.requestID !== request.requestID)
      }
      entry.pending.set(request.requestID, { request, resolve, reject, cleanup })
      signal.addEventListener("abort", cancel, { once: true })
      entry.queue.push(request)
      entry.wake?.()
    })
  }

  /**
   * Ask the shell to open a URL in the project browser, then list what that page
   * registered. This is the only way a page can reach the agent without the user
   * typing the address themselves; the pane shows the load and the user keeps the
   * ability to interrupt it.
   */
  export async function navigate(sessionID: SessionID, rawUrl: string, signal: AbortSignal) {
    const entry = enrolled(sessionID)
    const target = navigableUrl(rawUrl)
    await checkPolicyForOrigin(target.origin)
    if (signal.aborted) return fail("Browser request was aborted")
    if (entry.pending.size !== 0) return fail("Another browser invocation is in progress")
    const request: Request = {
      providerID: entry.id,
      epoch: entry.epoch,
      projectID: Instance.project.id,
      sessionID,
      generation: entry.snapshot.generation,
      origin: entry.snapshot.origin,
      frameId: entry.snapshot.frameId,
      requestID: randomUUID(),
      operation: "navigate",
      deadline: Date.now() + 30000,
      url: target.toString(),
    }
    const reply = await enqueue(entry, NavigateRequest.parse(request), signal)
    if (reply.status !== "Completed") return fail("The project browser could not open that page")
    // A redirect can land the document on an origin the caller never approved
    // (the approval is bound to `target.origin`). Fail closed rather than report
    // the approved origin while the pane sits on a different one.
    if (entry.snapshot.origin !== target.origin)
      return fail(
        "The project browser landed on a different origin than the one approved; ask the user before continuing",
      )
    return { url: target.toString(), origin: target.origin }
  }
  /** What the model last read for this element, so approval and refusals can name it. */
  export function describeRef(binding: Binding, readId: string, ref: string): OutlineEntry {
    const entry = bound(binding)
    const read = entry.lastRead
    if (!read || read.readId !== readId || read.generation !== entry.snapshot.generation)
      return fail("Element references are stale; read the page again")
    const found = read.refs.get(ref)
    if (!found) return fail(`There is no element ${ref} in the latest read`)
    return found
  }

  /** Read the visible text and an element outline of the enrolled page. */
  export async function read(binding: Binding, signal: AbortSignal) {
    const reply = await dispatch(binding, "read", signal)
    const entry = bound(binding)
    const parsed = ReadOutput.safeParse(reply.output)
    if (!parsed.success || bytes(parsed.data) > 65536) return fail("The project browser returned an unusable page read")
    assertNoCredentialOutput(parsed.data, "Credential-like page content cannot enter the coding session")
    entry.lastRead = {
      readId: parsed.data.readId,
      generation: entry.snapshot.generation,
      refs: new Map(parsed.data.outline.map((item) => [item.ref, item])),
    }
    return parsed.data
  }

  /**
   * Click, type into or select within an element named by the latest read. Typing refuses password and
   * credential-named fields and credential-shaped text. The page may navigate as a result; the reply
   * only reports whether the origin changed, never the new page's content.
   */
  export function prepareAction(
    binding: Binding,
    action: { readId: string; ref: string; how: "click" | "type" | "select"; text?: string },
  ) {
    const target = describeRef(binding, action.readId, action.ref)
    if (target.disabled) return fail(`Element ${action.ref} is disabled`)
    if (action.how !== "click") {
      if (typeof action.text !== "string" || action.text.length > 2000) return fail("Text of at most 2000 characters is required")
      if (target.kind === "password" || WebMcpProfile.maskedValue(action.text))
        return fail("Enter credentials manually in the browser")
      const node = { uid: action.ref, role: target.kind, name: target.name, focused: false, attributes: {} }
      if (action.how === "type" && WebMcpProfile.sensitiveTarget(node))
        return fail("Enter credentials and payment details manually in the browser")
    }
    if (action.how === "select" && !target.options) return fail(`Element ${action.ref} is not a selector`)
    return { ...action, target }
  }
  export async function act(
    binding: Binding,
    action: { readId: string; ref: string; how: "click" | "type" | "select"; text?: string },
    signal: AbortSignal,
  ) {
    const prepared = prepareAction(binding, action)
    const entry = bound(binding)
    const reply = await dispatch(binding, "act", signal, {
      readId: prepared.readId,
      ref: prepared.ref,
      how: prepared.how,
      text: prepared.text,
    })
    // The reply generation is the document the action ended on; a different one retires every reference.
    const navigated = entry.snapshot.generation !== binding.generation
    return {
      done: true,
      how: prepared.how,
      navigated,
      originChanged: entry.snapshot.origin !== binding.origin,
    }
  }

  /** Wait until the page shows some text, or report that it did not within the time. */
  export async function wait(binding: Binding, waitText: string, timeoutMs: number, signal: AbortSignal) {
    const reply = await dispatch(binding, "wait", signal, { waitText, timeoutMs })
    bound(binding)
    const output = z.object({ found: z.boolean() }).strict().safeParse(reply.output)
    if (!output.success) return fail("The project browser returned an unusable wait result")
    return output.data
  }
  export async function list(binding: Binding, signal: AbortSignal) {
    const reply = await dispatch(binding, "list", signal)
    if (!reply.snapshot) return fail("Native browser did not return a catalog")
    bound(binding)
    // A fresh catalog must match the identity that was approved before listing.
    if (canonical(reply.snapshot) !== canonical(bound(binding).snapshot))
      return fail("Tool catalog changed during listing")
    return reply.snapshot.tools.map((tool) => {
      const definitionDigest = digest(tool)
      return {
        ...tool,
        digest: definitionDigest,
        invoke: {
          action: "invoke" as const,
          toolName: tool.name,
          digest: definitionDigest,
          input: exampleInput(tool.inputSchema),
        },
      }
    })
  }
  /** Minimal object derived from a page tool schema. Required properties only. */
  export function exampleInput(schema: unknown): Record<string, unknown> {
    const value = exampleValue(schema, 0)
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
    return {}
  }
  function exampleValue(schema: unknown, depth: number): unknown {
    if (depth > 6 || !schema || typeof schema !== "object" || Array.isArray(schema)) return {}
    const record = schema as Record<string, unknown>
    if (Array.isArray(record.enum) && record.enum.length > 0) return jsonLiteral(record.enum[0])
    if ("const" in record) return jsonLiteral(record.const)
    if (Array.isArray(record.oneOf) && record.oneOf.length > 0) return exampleValue(record.oneOf[0], depth + 1)
    if (Array.isArray(record.anyOf) && record.anyOf.length > 0) return exampleValue(record.anyOf[0], depth + 1)
    const type = Array.isArray(record.type) ? record.type.find((item) => item !== "null") : record.type
    if (type === "string") return ""
    if (type === "number" || type === "integer") return 0
    if (type === "boolean") return false
    if (type === "array") return []
    if (type === "null") return null
    const properties =
      record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)
        ? (record.properties as Record<string, unknown>)
        : {}
    const required = Array.isArray(record.required) ? record.required.filter((key): key is string => typeof key === "string") : []
    const input: Record<string, unknown> = {}
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) continue
      input[key] = exampleValue(properties[key], depth + 1)
    }
    return input
  }
  function jsonLiteral(value: unknown) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
    return {}
  }
  const PREVIEW_MAX_BYTES = 2048
  /**
   * JSON view of the detached input for the permission prompt. Secret-like keys are
   * replaced at any depth. When the encoding exceeds 2 KiB, the result is a UTF-8-safe
   * prefix of what will be sent plus `… (N bytes, M not shown)`. Never log the input
   * or this preview. Value-level secrets under innocuous keys are not redacted.
   */
  export function inputPreview(input: Record<string, unknown>) {
    let json = "{}"
    try {
      json = JSON.stringify(redactSecrets(input)) ?? "{}"
    } catch {
      return "{}"
    }
    const total = Buffer.byteLength(json, "utf8")
    if (total <= PREVIEW_MAX_BYTES) return json
    // The marker is widest when nothing is shown (dropped has the most digits).
    const widest = Buffer.byteLength(previewMarker(total, 0), "utf8")
    const budget = PREVIEW_MAX_BYTES - widest
    if (budget <= 0) return previewMarker(total, 0)
    const head = truncateUtf8(json, budget)
    return head + previewMarker(total, Buffer.byteLength(head, "utf8"))
  }
  function previewMarker(total: number, shown: number) {
    return `… (${total} bytes, ${total - shown} not shown)`
  }
  function truncateUtf8(json: string, maxBytes: number) {
    const buf = Buffer.from(json, "utf8")
    let end = Math.min(Math.max(maxBytes, 0), buf.length)
    while (end > 0 && (buf[end - 1]! & 0xc0) === 0x80) end--
    if (end > 0 && (buf[end - 1]! & 0xc0) === 0xc0) end--
    return buf.subarray(0, end).toString("utf8")
  }
  // Whole-token or suffix for `key`, so `keyboard` stays visible. Other secret words
  // match anywhere in the folded token (`accesstoken`, `clientsecret`, `pässword`).
  const SECRET_WORDS = ["password", "passwd", "secret", "token", "authorization", "cookie", "apikey"]
  function secretLikeKey(key: string) {
    const tokens = key
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
    return tokens.some((token) => token.endsWith("key") || SECRET_WORDS.some((word) => token.includes(word)))
  }
  function redactSecrets(value: unknown, depth = 0): unknown {
    if (depth > 32) return null
    if (Array.isArray(value)) return value.map((item) => redactSecrets(item, depth + 1))
    if (!value || typeof value !== "object") return value
    const redacted: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      redacted[key] = secretLikeKey(key) ? "[redacted]" : redactSecrets(item, depth + 1)
    }
    return redacted
  }
  function schemaPointer(error: { instancePath?: string; keyword?: string; params?: Record<string, unknown> }) {
    const base = error.instancePath && error.instancePath.length > 0 ? error.instancePath : ""
    const missing = error.params?.missingProperty
    if (error.keyword === "required" && typeof missing === "string") return `${base}/${missing}`
    const additional = error.params?.additionalProperty
    if (error.keyword === "additionalProperties" && typeof additional === "string") return `${base}/${additional}`
    return base || "/"
  }
  const NESTED_SCHEMA_MAPS = new Set(["properties", "$defs", "definitions", "dependentSchemas"])
  const SCHEMA_ARRAY_KEYS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"])
  const SCHEMA_VALUE_KEYS = new Set([
    "additionalProperties",
    "unevaluatedProperties",
    "additionalItems",
    "contains",
    "not",
    "if",
    "then",
    "else",
    "propertyNames",
    "unevaluatedItems",
    "contentSchema",
  ])
  // `pattern` / `patternProperties` are regexes Ajv would run on the event loop.
  // Only schema keywords count: a property or default named "pattern" is not one.
  function schemaHasUnsafePattern(schema: unknown) {
    const pending = [schema]
    const seen = new Set<object>()
    while (pending.length) {
      const current = pending.pop()
      if (!current || typeof current !== "object" || Array.isArray(current)) continue
      if (seen.has(current)) continue
      seen.add(current)
      const record = current as Record<string, unknown>
      if (Object.hasOwn(record, "pattern") && typeof record.pattern === "string") return true
      if (Object.hasOwn(record, "patternProperties")) return true
      for (const [key, value] of Object.entries(record)) {
        if (key === "items") {
          if (Array.isArray(value)) for (const child of value) pending.push(child)
          else pending.push(value)
          continue
        }
        if (NESTED_SCHEMA_MAPS.has(key) && value && typeof value === "object" && !Array.isArray(value)) {
          for (const child of Object.values(value)) pending.push(child)
          continue
        }
        if (SCHEMA_ARRAY_KEYS.has(key) && Array.isArray(value)) {
          for (const child of value) pending.push(child)
          continue
        }
        if (SCHEMA_VALUE_KEYS.has(key)) pending.push(value)
      }
    }
    return false
  }
  function takeValidator(cache: Map<string, InputValidator>, key: string) {
    const found = cache.get(key)
    if (!found) return undefined
    cache.delete(key)
    cache.set(key, found)
    return found
  }
  function rememberValidator(cache: Map<string, InputValidator>, key: string, validate: InputValidator) {
    cache.delete(key)
    cache.set(key, validate)
    while (cache.size > VALIDATOR_CACHE_LIMIT) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }
  function rejectSchema(validate: InputValidator, input: Record<string, unknown>) {
    if (validate(input)) return
    const path = schemaPointer(validate.errors?.[0] ?? {})
    return fail(`Input does not match the tool schema at ${path}`, { path, reason: "invalid-input" })
  }
  // Page schemas are untrusted and may repeat $id values. Validators are cached per digest.
  function assertInputSchema(
    schema: unknown,
    input: Record<string, unknown>,
    digestKey: string,
    cache: Map<string, InputValidator>,
  ) {
    if (schema === undefined) return
    const cached = takeValidator(cache, digestKey)
    if (cached) return rejectSchema(cached, input)
    let document: Record<string, unknown>
    try {
      const parsed = parseJsonStrict(JSON.stringify(schema))
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("The tool schema could not be checked")
      document = parsed as Record<string, unknown>
    } catch {
      return fail("The tool schema could not be checked")
    }
    delete document.$schema
    delete document.$id
    if (schemaHasUnsafePattern(document)) return fail("The tool schema could not be checked")
    let validate: InputValidator
    try {
      validate = new Ajv({ strict: false, allErrors: false, validateSchema: false, validateFormats: false }).compile(
        document,
      )
    } catch {
      return fail("The tool schema could not be checked")
    }
    rememberValidator(cache, digestKey, validate)
    return rejectSchema(validate, input)
  }
  export function prepareInvocation(binding: Binding, toolName: string, expectedDigest: string, input: unknown) {
    const entry = bound(binding)
    const tool = entry.snapshot.tools.find((tool) => tool.name === toolName)
    if (!tool) return fail("Tool was not in the latest listing; list tools and choose a listed name")
    if (digest(tool) !== expectedDigest) return fail("Tool definition changed; list tools and authorize again")
    if (bytes(input) > 65536 || !input || typeof input !== "object" || Array.isArray(input))
      return fail("Input must be a JSON object of at most 64 KiB")
    const frozenInput = parseJsonStrict(JSON.stringify(input)) as Record<string, unknown>
    // Schema check happens before permission is asked. The failing path is the JSON pointer.
    // The approval callback calls prepareInvocation again and reuses this provider's cache.
    assertInputSchema(tool.inputSchema, frozenInput, expectedDigest, entry.validators)
    const pending = [{ value: frozenInput as unknown, path: "" }]
    while (pending.length) {
      const current = pending.pop()!
      if (typeof current.value === "string" && WebMcpProfile.maskedValue(current.value))
        return fail("Enter credentials manually in the browser", { path: current.path || "/" })
      if (current.value && typeof current.value === "object") {
        for (const [key, item] of Object.entries(current.value)) {
          const path = `${current.path}/${key}`
          if (/^(password|passwd|secret|token|api[_-]?key|authorization|cookie)$/i.test(key))
            return fail("Credential fields are not accepted in agent input", { path })
          pending.push({ value: item, path })
        }
      }
    }
    return { toolName, digest: expectedDigest, input: frozenInput }
  }
  function assertNoCredentialOutput(output: unknown, message: string) {
    const values = [output] as unknown[]
    while (values.length) {
      const value = values.pop()
      if (
        typeof value === "string" &&
        (WebMcpProfile.maskedValue(value) ||
          /"(?:password|passwd|secret|token|api[_-]?key|authorization|cookie)"\s*:/i.test(value))
      ) {
        return fail(message)
      }
      if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
          if (/^(password|passwd|secret|token|api[_-]?key|authorization|cookie)$/i.test(key)) return fail(message)
          values.push(item)
        }
      }
    }
  }
  export async function invoke(
    binding: Binding,
    toolName: string,
    expectedDigest: string,
    input: unknown,
    signal: AbortSignal,
  ) {
    const prepared = prepareInvocation(binding, toolName, expectedDigest, input)
    const reply = await dispatch(binding, "invoke", signal, prepared)
    bound(binding)
    if (reply.output === undefined) return fail("Native completion did not include an output")
    if (bytes(reply.output) > 65536) return fail("Tool output exceeds 64 KiB")
    assertNoCredentialOutput(reply.output, "Credential-like tool output cannot enter the coding session")
    return reply.output
  }
}
