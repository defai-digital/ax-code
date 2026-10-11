import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { Instance } from "../project/instance"
import { Session } from "../session"
import { SessionID } from "../session/schema"
import { Config } from "../config/config"
import { exactOrigin } from "./webmcp-origin"
import { WebMcpProfile } from "./webmcp-profile"
import { parseJsonStrict } from "../util/json-value"

// Captured from the trusted launcher once, never from project configuration.
const hostToken = process.env.AX_CODE_DESKTOP_BROWSER_TOKEN

export namespace DesktopBrowser {
  export const CAPABILITY = "desktop.webmcp.v1"
  export const HEADER = "x-ax-desktop-browser-token"
  export const Failure = NamedError.create("DesktopBrowserUnavailable", z.object({ reason: z.string() }))
  const fail = (reason: string): never => {
    throw new Failure({ reason })
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
  export const Request = Binding.extend({
    requestID: ID,
    operation: z.enum(["list", "invoke"]),
    deadline: z.number().int(),
    toolName: z.string().max(256).optional(),
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    input: z.record(z.string(), z.unknown()).optional(),
  })
    .strict()
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
    wake?: () => void
    polling: boolean
  }
  const state = Instance.state(
    () => new Map<string, Provider>(),
    async (providers) => {
      for (const provider of providers.values()) retire(provider)
      providers.clear()
    },
  )

  export function bytes(value: unknown) {
    try {
      return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8")
    } catch {
      return Number.POSITIVE_INFINITY
    }
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
    return typeof hostToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(hostToken)
  }
  export function hostAuthorized(value: string | undefined) {
    if (!enabled() || !value) return false
    const expected = Buffer.from(hostToken!)
    const actual = Buffer.from(value)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }
  function retire(provider: Provider) {
    for (const pending of [...provider.pending.values()]) {
      provider.canceled.push(pending.request.requestID)
      pending.cleanup()
      pending.reject(new Failure({ reason: "Browser connection or document changed; completion is unconfirmed" }))
    }
    provider.queue.length = 0
    provider.canceled = provider.canceled.slice(-8)
    provider.wake?.()
  }
  function provider(id: string) {
    const found = state().get(id)
    if (!found || Date.now() - found.touched > 45000) {
      if (found) {
        retire(found)
        state().delete(id)
      }
      return fail("Desktop browser is disconnected")
    }
    return found
  }
  export async function enroll(input: z.infer<typeof Enrollment>) {
    if (!enabled()) return fail("Desktop browser provider is not enabled by the launcher")
    const info = await Session.get(input.sessionID)
    if (info.projectID !== Instance.project.id || info.directory !== Instance.directory)
      return fail("Session belongs to another project")
    const policy = (await Config.get()).webmcp
    if (policy?.allow === false) return fail("WebMCP is disabled by managed policy")
    const providers = state()
    for (const old of providers.values()) {
      if (old.sessionID === input.sessionID) {
        retire(old)
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
      polling: false,
    }
    providers.set(entry.id, entry)
    return { providerID: entry.id, epoch: entry.epoch, projectID: Instance.project.id, capability: CAPABILITY } as const
  }
  export function disconnect(id: string) {
    const entry = state().get(id)
    if (!entry) return
    retire(entry)
    state().delete(id)
  }
  export function update(id: string, snapshot: Snapshot) {
    const entry = provider(id)
    const next = Snapshot.parse(snapshot)
    // Catalog changes retire already-approved calls even within the same document.
    if (canonical(next) !== canonical(entry.snapshot)) retire(entry)
    entry.snapshot = next
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
    if (!pending || pending.request.generation !== reply.generation || entry.snapshot.generation !== reply.generation) {
      return fail("Response belongs to an expired browser request")
    }
    const result = Reply.parse(reply)
    pending.cleanup()
    if (result.status !== "Completed")
      pending.reject(
        new Failure({ reason: "Native invocation did not confirm completion; do not retry automatically" }),
      )
    else pending.resolve(result)
  }
  export function forSession(sessionID: SessionID) {
    const entries = [...state().values()].filter((entry) => entry.sessionID === sessionID)
    if (entries.length !== 1) return fail("Enable the project browser for this coding session first")
    const entry = provider(entries[0]!.id)
    if (!entry.snapshot.origin || !entry.snapshot.frameId)
      return fail("Navigate the browser to an HTTPS or loopback page first")
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
  async function dispatch(
    binding: Binding,
    operation: Request["operation"],
    signal: AbortSignal,
    extra: Pick<Request, "toolName" | "digest" | "input"> = {},
  ) {
    await checkPolicy(binding)
    if (signal.aborted) return fail("Browser request was aborted")
    const entry = bound(binding)
    if (entry.pending.size !== 0) return fail("Another browser invocation is in progress")
    const request: Request = { ...binding, ...extra, requestID: randomUUID(), operation, deadline: Date.now() + 30000 }
    return new Promise<Reply>((resolve, reject) => {
      const cancel = () => {
        cleanup()
        // Cancellations are delivered privately, never on the global event bus.
        entry.canceled.push(request.requestID)
        entry.canceled = entry.canceled.slice(-8)
        entry.wake?.()
        reject(new Failure({ reason: "Browser request canceled or timed out; completion is unconfirmed" }))
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
  export async function list(binding: Binding, signal: AbortSignal) {
    const reply = await dispatch(binding, "list", signal)
    if (!reply.snapshot) return fail("Native browser did not return a catalog")
    bound(binding)
    // A fresh catalog must match the identity that was approved before listing.
    if (canonical(reply.snapshot) !== canonical(bound(binding).snapshot))
      return fail("Tool catalog changed during listing")
    return reply.snapshot.tools.map((tool) => ({ ...tool, digest: digest(tool) }))
  }
  export function prepareInvocation(binding: Binding, toolName: string, expectedDigest: string, input: unknown) {
    const entry = bound(binding)
    const tool = entry.snapshot.tools.find((tool) => tool.name === toolName)
    if (!tool || digest(tool) !== expectedDigest) return fail("Tool definition changed; list tools and authorize again")
    if (bytes(input) > 65536 || !input || typeof input !== "object" || Array.isArray(input))
      return fail("Input must be a JSON object of at most 64 KiB")
    const frozenInput = parseJsonStrict(JSON.stringify(input)) as Record<string, unknown>
    const values = [frozenInput] as unknown[]
    while (values.length) {
      const value = values.pop()
      if (typeof value === "string" && WebMcpProfile.maskedValue(value))
        return fail("Enter credentials manually in the browser")
      if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
          if (/^(password|passwd|secret|token|api[_-]?key|authorization|cookie)$/i.test(key))
            return fail("Credential fields are not accepted in agent input")
          values.push(item)
        }
      }
    }
    return { toolName, digest: expectedDigest, input: frozenInput }
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
    const values = [reply.output] as unknown[]
    while (values.length) {
      const value = values.pop()
      if (
        typeof value === "string" &&
        (WebMcpProfile.maskedValue(value) ||
          /"(?:password|passwd|secret|token|api[_-]?key|authorization|cookie)"\s*:/i.test(value))
      ) {
        return fail("Credential-like tool output cannot enter the coding session")
      }
      if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
          if (/^(password|passwd|secret|token|api[_-]?key|authorization|cookie)$/i.test(key)) {
            return fail("Credential-like tool output cannot enter the coding session")
          }
          values.push(item)
        }
      }
    }
    return reply.output
  }
}
