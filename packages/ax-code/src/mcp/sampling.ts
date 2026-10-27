import type { Client, ClientCapabilities } from "@modelcontextprotocol/client"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { Instance } from "../project/instance"
import type { Permission } from "../permission"
import type { MessageV2 } from "../session/message-v2"
import { stripHiddenUnicode } from "../util/untrusted-content"
import { ScopedFlag } from "@/flag/scoped"
import { isRecord } from "@/util/record"
import { SessionID } from "@/session/schema"
import { McpElicitation } from "./elicitation"

const log = Log.create({ service: "mcp.sampling" })

/** Wire-level result returned to the server. */
type CreateMessageResult = {
  model: string
  role: "assistant"
  content: { type: "text"; text: string }
  stopReason?: "endTurn" | "maxTokens" | "stopSequence" | string
}

/** What the LLM helper must produce. Kept tiny so a test can fake it. */
export type SamplingCompletion = {
  text: string
  model: string
  stopReason?: CreateMessageResult["stopReason"]
}

/** What `generate` needs to know to call the LLM. */
export type GenerateInput = {
  sessionID: SessionID
  signal: AbortSignal
  systemPrompt?: string
  messages: Array<{ role: "user" | "assistant"; text: string }>
  maxTokens: number
}

/** Side-effect-free LLM call. The production implementation is `defaultGenerate`. */
export type GenerateFn = (input: GenerateInput) => Promise<SamplingCompletion>

/**
 * Sampling is opt-in (ADR-240) and per-call approved. The handler:
 *  1. resolves the in-flight session call (decline if none);
 *  2. asks the user for permission with the server name as pattern;
 *  3. runs ONE tool-less completion with the session's model, capped output,
 *     60 s timeout, abort tied to the call signal;
 *  4. returns text-only to the server.
 *
 * Server-supplied `systemPrompt` and message text are untrusted; hidden
 * Unicode (ADR-206) is stripped before they reach the prompt, and a
 * 60 s deadline aborts any call that the server keeps alive.
 */
export namespace McpSampling {
  // The per-call output cap. ADR-240 says 2000, overrideable per config.
  export const DEFAULT_MAX_TOKENS = 2000
  /** One minute — a sampling call must never own a longer budget. */
  export const SAMPLING_TIMEOUT_MS = 60_000
  /** Hard upper bound on server-supplied message text length per message. */
  export const MAX_TEXT_CHARS = 4_000
  /** Hard upper bound on system prompt length. */
  export const MAX_SYSTEM_PROMPT_CHARS = 4_000
  /** Hard upper bound on the number of server-supplied messages. */
  export const MAX_MESSAGES = 32
  /** Per-minute cap, per server. */
  export const RATE_LIMIT_PER_MINUTE = 5
  /** Per-session cap, per server. */
  export const RATE_LIMIT_PER_SESSION = 20
  /** Window for the per-minute cap. */
  const RATE_LIMIT_WINDOW_MS = 60_000

  // ---------------------------------------------------------------------
  // Rate limiter (pure, injectable clock)
  // ---------------------------------------------------------------------

  export type RateLimiterOptions = {
    now?: () => number
    windowMs?: number
    perMinute?: number
    perSession?: number
  }

  /**
   * Per-server sliding-window + session counter. `tryConsume()` returns true
   * when the request is within both limits, false otherwise. A successful
   * consume also advances the state. The clock is injectable so tests can
   * step the window without sleeping.
   */
  export class RateLimiter {
    private readonly now: () => number
    private readonly windowMs: number
    private readonly perMinute: number
    private readonly perSession: number
    private readonly recent: number[] = []
    private sessionCount = 0
    private disposed = false

    constructor(options: RateLimiterOptions = {}) {
      this.now = options.now ?? Date.now
      this.windowMs = options.windowMs ?? RATE_LIMIT_WINDOW_MS
      this.perMinute = options.perMinute ?? RATE_LIMIT_PER_MINUTE
      this.perSession = options.perSession ?? RATE_LIMIT_PER_SESSION
    }

    /** True when the next call would fit in both caps, AND advances state. */
    tryConsume(): boolean {
      if (this.disposed) return false
      if (this.sessionCount >= this.perSession) return false
      const t = this.now()
      // Drop entries older than the window.
      while (this.recent.length > 0 && t - (this.recent[0] ?? 0) >= this.windowMs) this.recent.shift()
      if (this.recent.length >= this.perMinute) return false
      this.recent.push(t)
      this.sessionCount++
      return true
    }

    dispose(): void {
      this.disposed = true
    }
  }

  // Per-server limiters live for the lifetime of the McpSampling module.
  // They are recreated whenever a server reconnects (a reconnect means
  // "new client" at the MCP level), so a sustained outage of one server
  // does not bleed allowance from its replacement.
  const limiters = new Map<string, RateLimiter>()

  function limiterFor(server: string): RateLimiter {
    let l = limiters.get(server)
    if (!l) {
      l = new RateLimiter()
      limiters.set(server, l)
    }
    return l
  }

  // Drop the limiter when the instance directory goes away, so the next
  // instance starts with a clean per-session counter (the per-minute
  // window would still roll naturally).
  void Instance.state(
    () => ({ directory: Instance.directory }),
    async () => {
      for (const l of limiters.values()) l.dispose()
      limiters.clear()
    },
  )

  // ---------------------------------------------------------------------
  // Request validation + sanitisation
  // ---------------------------------------------------------------------

  /**
   * Sanitize and length-cap a single text. Hidden Unicode is dropped
   * (ADR-206); the result is plain visible text or empty.
   */
  export function sanitizeText(value: unknown, maxChars: number): string {
    if (typeof value !== "string") return ""
    const stripped = stripHiddenUnicode(value).text
    const trimmed = stripped.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    const chars = [...trimmed.trim()]
    if (chars.length === 0) return ""
    if (chars.length <= maxChars) return chars.join("")
    return `${chars.slice(0, maxChars).join("")}...`
  }

  export type SanitizedMessage = { role: "user" | "assistant"; text: string }

  export type PlannedRequest = {
    ok: true
    systemPrompt: string
    messages: SanitizedMessage[]
    requestedMaxTokens: number
  }

  export type PlanFailure = { ok: false; reason: string }

  /**
   * Validate and sanitize a `sampling/createMessage` payload. Anything the
   * server is not allowed to ask for (oversized, wrong shape, hidden
   * Unicode) is rejected with a reason the handler can pass back as a
   * JSON-RPC error message.
   */
  export function planRequest(input: { params: unknown; maxTokensCap: number }): PlannedRequest | PlanFailure {
    const { params } = input
    if (!isRecord(params)) return { ok: false, reason: "params must be an object" }
    if (typeof params.maxTokens !== "number" || !Number.isFinite(params.maxTokens) || params.maxTokens <= 0) {
      return { ok: false, reason: "maxTokens is required and must be a positive number" }
    }
    const requestedMaxTokens = Math.min(Math.floor(params.maxTokens), input.maxTokensCap)
    if (requestedMaxTokens <= 0) {
      return { ok: false, reason: "maxTokens resolved to zero or negative after capping" }
    }
    if (!Array.isArray(params.messages) || params.messages.length === 0) {
      return { ok: false, reason: "messages must be a non-empty array" }
    }
    if (params.messages.length > MAX_MESSAGES) {
      return { ok: false, reason: `messages must contain at most ${MAX_MESSAGES} entries` }
    }
    const messages: SanitizedMessage[] = []
    for (const [index, raw] of params.messages.entries()) {
      if (!isRecord(raw) || typeof raw.role !== "string") {
        return { ok: false, reason: `message ${index} has no role` }
      }
      if (raw.role !== "user" && raw.role !== "assistant") {
        return { ok: false, reason: `message ${index} has an unsupported role: ${raw.role}` }
      }
      if (!isRecord(raw.content) || raw.content.type !== "text" || typeof raw.content.text !== "string") {
        return { ok: false, reason: `message ${index} must be a text content block` }
      }
      const text = sanitizeText(raw.content.text, MAX_TEXT_CHARS)
      messages.push({ role: raw.role, text })
    }
    const systemPrompt =
      typeof params.systemPrompt === "string" ? sanitizeText(params.systemPrompt, MAX_SYSTEM_PROMPT_CHARS) : ""
    return { ok: true, systemPrompt, messages, requestedMaxTokens }
  }

  // ---------------------------------------------------------------------
  // LLM call
  // ---------------------------------------------------------------------

  /**
   * Default `GenerateFn` — runs one tool-less completion on the session's
   * model (mirrors `SessionBtw.generate` / the recap lane, ADR-213). The
   * session is resolved so the token ledger and telemetry align with
   * regular session traffic; the call itself is out-of-transcript, has
   * no tools, no retries, and an explicit output cap.
   *
   * Errors from this function must surface to the caller so the handler
   * can return a JSON-RPC error rather than silently forwarding an empty
   * string.
   */
  export async function defaultGenerate(input: GenerateInput): Promise<SamplingCompletion> {
    // Loaded lazily: this module is reached from permission/ through mcp/, and
    // a static import of agent/, provider/ and session/ closes an import cycle
    // that leaves Permission undefined while session/index.ts is evaluated.
    const [{ Agent }, { Provider }, { LLM }, { Session }] = await Promise.all([
      import("../agent/agent"),
      import("../provider/provider"),
      import("../session/llm"),
      import("../session"),
    ])
    const agent = await Agent.get("recap")
    if (!agent) throw new Error("recap agent is not available")
    // Reuse the last user message as a session marker so the token ledger
    // and telemetry align with the regular session; the actual prompt is
    // the server-supplied system + messages.
    const history = await Session.messages({ sessionID: input.sessionID })
    const lastEntry = [...history].reverse().find((entry) => entry.info.role === "user")
    if (!lastEntry) throw new Error("the session has no user message to attach a sampling call to")
    const lastUser: MessageV2.User = lastEntry.info as MessageV2.User
    const requested = await Provider.resolveRequestedModel(lastUser.model)
    const model = await Provider.getModel(requested.providerID, requested.modelID)
    const result = await LLM.stream({
      agent,
      user: lastUser,
      system: input.systemPrompt ? [input.systemPrompt] : [],
      small: true,
      tools: {},
      model,
      abort: AbortSignal.any([AbortSignal.timeout(SAMPLING_TIMEOUT_MS), input.signal]),
      sessionID: input.sessionID,
      retries: 0,
      maxOutputTokens: input.maxTokens,
      messages: input.messages.map((m) => ({ role: m.role, content: m.text })),
    })
    const text = await Promise.resolve(result.text)
    const cleaned = typeof text === "string" ? text.trim() : ""
    if (!cleaned) throw new Error("model returned no text")
    return {
      text: cleaned,
      model: `${requested.providerID}/${requested.modelID}`,
      stopReason: "endTurn",
    }
  }

  // ---------------------------------------------------------------------
  // Decision
  // ---------------------------------------------------------------------

  export type AskPermissionFn = (input: {
    sessionID: SessionID
    ruleset?: Permission.Ruleset
    agent?: string
    server: string
    messageCount: number
    requestedMaxTokens: number
    signal?: AbortSignal
  }) => Promise<"allow" | "deny">

  export type Decision =
    | { kind: "decline"; reason: string }
    | { kind: "cancel" }
    | { kind: "reject"; code: number; message: string }

  /**
   * Validate, ask, and call the model. Every non-allow path returns a
   * structured Decision the handler converts to a JSON-RPC error reply.
   * `input.params` is the raw request body the SDK handed us.
   */
  export async function decide(input: {
    server: string
    params: unknown
    call: McpElicitation.CallContext | undefined
    autonomous: boolean
    rateLimited: boolean
    maxTokensCap: number
    ask: AskPermissionFn
    generate: GenerateFn
  }): Promise<{ kind: "ok"; result: CreateMessageResult } | Decision> {
    if (input.autonomous) {
      return { kind: "decline", reason: "autonomous mode never runs MCP sampling" }
    }
    if (!input.call) {
      return { kind: "decline", reason: "no in-flight session call can surface the permission" }
    }
    if (input.rateLimited) {
      return {
        kind: "reject",
        code: -32029, // generic application error, distinct from JSON-RPC codes
        message: `rate limit exceeded for server ${input.server}`,
      }
    }
    const plan = planRequest({ params: input.params, maxTokensCap: input.maxTokensCap })
    if (!plan.ok) {
      return { kind: "reject", code: -32602, message: plan.reason }
    }
    let approval: "allow" | "deny"
    try {
      approval = await input.ask({
        sessionID: input.call.sessionID,
        ruleset: input.call.ruleset,
        agent: input.call.agent,
        server: input.server,
        messageCount: plan.messages.length,
        requestedMaxTokens: plan.requestedMaxTokens,
        signal: input.call.signal,
      })
    } catch (error) {
      if (input.call.signal?.aborted) return { kind: "cancel" }
      const { Permission: PermissionRuntime } = await import("../permission")
      if (error instanceof PermissionRuntime.RejectedError) {
        return { kind: "decline", reason: "the user dismissed the prompt" }
      }
      return { kind: "decline", reason: `asking failed: ${toErrorMessage(error)}` }
    }
    if (approval !== "allow") {
      return { kind: "decline", reason: "the user denied the sampling request" }
    }
    let completion: SamplingCompletion
    try {
      completion = await input.generate({
        sessionID: input.call.sessionID,
        signal: input.call.signal ?? new AbortController().signal,
        systemPrompt: plan.systemPrompt,
        messages: plan.messages,
        maxTokens: plan.requestedMaxTokens,
      })
    } catch (error) {
      log.warn("sampling completion failed", { server: input.server, error: toErrorMessage(error) })
      return {
        kind: "reject",
        code: -32603,
        message: `model completion failed: ${toErrorMessage(error)}`,
      }
    }
    return {
      kind: "ok",
      result: {
        model: completion.model,
        role: "assistant",
        content: { type: "text", text: completion.text },
        ...(completion.stopReason ? { stopReason: completion.stopReason } : {}),
      },
    }
  }

  // ---------------------------------------------------------------------
  // Client wiring
  // ---------------------------------------------------------------------

  /**
   * The capability advertised on every MCP client. When sampling is off
   * (the default) the client returns no `sampling` field, so a server
   * that checks the capability will not even send `sampling/createMessage`.
   * When sampling is on, an empty object is sufficient (ADR-240).
   */
  export function clientCapabilities(enabled: boolean): Pick<ClientCapabilities, "sampling"> | Record<string, never> {
    return enabled ? { sampling: {} } : {}
  }

  /**
   * Register the `sampling/createMessage` handler on a client. Bound to
   * the instance context so the permission state, session prompt and
   * autonomous flag resolve against the same project directory for the
   * client's whole lifetime.
   */
  export function registerHandler(
    client: Client,
    serverName: string,
    options: {
      maxTokens?: number
      generate?: GenerateFn
      ask?: AskPermissionFn
    } = {},
  ): void {
    const cap = options.maxTokens ?? DEFAULT_MAX_TOKENS
    const generate = options.generate ?? defaultGenerate
    const ask = options.ask ?? defaultAskPermission
    client.setRequestHandler(
      "sampling/createMessage",
      Instance.bind(async (request: { params: unknown }): Promise<CreateMessageResult> => {
        const limiter = limiterFor(serverName)
        const decision = await decide({
          server: serverName,
          params: request.params,
          call: McpElicitation.currentCall(client),
          autonomous: ScopedFlag.autonomous(),
          rateLimited: !limiter.tryConsume(),
          maxTokensCap: cap,
          ask,
          generate,
        })
        if (decision.kind === "ok") {
          log.info("mcp sampling resolved", { server: serverName, ok: true })
          return decision.result
        }
        if (decision.kind === "cancel") {
          throw { code: -32800, message: "the tool call was aborted" }
        }
        if (decision.kind === "reject") {
          log.info("mcp sampling rejected", { server: serverName, code: decision.code, message: decision.message })
          throw { code: decision.code, message: decision.message }
        }
        log.info("mcp sampling declined", { server: serverName, reason: decision.reason })
        throw { code: -32000, message: decision.reason }
      }),
    )
  }
}

// ---------------------------------------------------------------------
// Default permission ask implementation
// ---------------------------------------------------------------------

/**
 * Default `AskPermissionFn` — goes through the standard permission layer
 * with the server name as the pattern. The user sees the server name,
 * message count and requested max tokens; the permission name `mcp_sampling`
 * is what the `permission` table stores.
 */
export async function defaultAskPermission(input: {
  sessionID: SessionID
  ruleset?: Permission.Ruleset
  agent?: string
  server: string
  messageCount: number
  requestedMaxTokens: number
  signal?: AbortSignal
}): Promise<"allow" | "deny"> {
  const { Permission: PermissionRuntime } = await import("../permission")
  const { Session } = await import("../session")
  const { Agent } = await import("../agent/agent")
  const session = await Session.get(input.sessionID)
  const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))
  // The calling agent can vanish on a config reload; with no ruleset to
  // consult, refuse rather than spend tokens unchecked.
  if (!agent) return "deny"
  if (
    [agent.permission, session.permission ?? [], input.ruleset ?? []].some(
      (layer) => PermissionRuntime.evaluate("mcp_sampling", input.server, layer).action === "deny",
    )
  )
    return "deny"
  // Built-in wildcard tool grants do not opt a server into spending model tokens.
  // Explicit configured grants are added by Permission.ask; retain all caller denials.
  const ruleset = PermissionRuntime.merge(agent.permission, session.permission ?? [], input.ruleset ?? []).filter(
    (rule) => rule.action !== "allow" || rule.permission !== "*",
  )
  try {
    await PermissionRuntime.ask(
      {
        sessionID: input.sessionID,
        permission: "mcp_sampling",
        patterns: [input.server],
        always: [input.server],
        metadata: {
          mcp: true,
          kind: "sampling",
          server: input.server,
          messageCount: input.messageCount,
          requestedMaxTokens: input.requestedMaxTokens,
        },
        ruleset,
        agent: agent.name,
      },
      { signal: input.signal },
    )
    return "allow"
  } catch (error) {
    if (error instanceof PermissionRuntime.RejectedError || error instanceof PermissionRuntime.DeniedError)
      return "deny"
    if (input.signal?.aborted) return "deny"
    throw error
  }
}
