/**
 * ax-code Programmatic SDK entry point
 *
 * This file lives inside the ax-code package to avoid import resolution
 * issues. It initializes Log and then exposes the agent API.
 *
 * Usage from SDK:
 *   import { createAgent } from "ax-code/sdk/programmatic"
 */

import z from "zod"
import { Log } from "../util/log.js"
import { bootstrap } from "../cli/bootstrap.js"
import { Server } from "../server/server.js"
import { Auth } from "../auth/index.js"
import { ToolRegistry } from "../tool/registry.js"
import { Tool } from "../tool/tool.js"
import { setLanguage, t } from "../i18n/index.js"
import { createOpencodeClient } from "@ax-code/sdk/v2/client"
import type { OpencodeClient } from "@ax-code/sdk/v2/client"
import { internalBaseUrl } from "../util/internal-url.js"
import type {
  ApiError,
  Message as ApiMessage,
  Part as ApiPart,
  Provider as ApiProvider,
  Session as ApiSession,
  SessionMessagesResponse,
} from "../../../sdk/js/src/v2/gen/types.gen.js"
import type {
  Agent,
  AgentOptions,
  RunOptions,
  RunResult,
  StreamEvent,
  StreamHandle,
  SessionHandle,
  ToolCallInfo,
  SdkTool,
} from "../../../sdk/js/src/programmatic/types.js"
import {
  DisposedError,
  TimeoutError,
  AgentNotFoundError,
  ProviderError,
  ToolError,
} from "../../../sdk/js/src/programmatic/types.js"

// Re-export error classes so they can be imported from this module
export {
  AxCodeError,
  ProviderError,
  TimeoutError,
  ToolError,
  PermissionError,
  AgentNotFoundError,
  DisposedError,
} from "../../../sdk/js/src/programmatic/types.js"

function last<T, S extends T>(list: T[], test: (item: T) => item is S): S | undefined
function last<T>(list: T[], test: (item: T) => boolean): T | undefined {
  for (let i = list.length - 1; i >= 0; i--) {
    if (test(list[i]!)) return list[i]
  }
}

type SessionMessageRecord = SessionMessagesResponse[number]
type AssistantMessageRecord = SessionMessageRecord & {
  info: Extract<ApiMessage, { role: "assistant" }>
}

function isAssistantMessageRecord(message: SessionMessageRecord): message is AssistantMessageRecord {
  return message.info.role === "assistant"
}

function isTextPart(part: ApiPart): part is Extract<ApiPart, { type: "text" }> {
  return part.type === "text"
}

function lastAssistantMessage(messages: SessionMessagesResponse | undefined): AssistantMessageRecord | undefined {
  return last(messages ?? [], isAssistantMessageRecord)
}

function getSessionUsage(message: AssistantMessageRecord | undefined) {
  const tokens = message?.info.tokens
  if (!tokens) return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  return {
    promptTokens: tokens.input ?? 0,
    completionTokens: tokens.output ?? 0,
    totalTokens: tokens.total ?? (tokens.input ?? 0) + (tokens.output ?? 0),
  }
}

function getFinalAssistantText(message: AssistantMessageRecord | undefined) {
  const textPart = last(message?.parts ?? [], (part): part is Extract<ApiPart, { type: "text" }> => {
    return isTextPart(part) && part.text.length > 0
  })
  return textPart?.text
}

function getToolOutput(state: Extract<ApiPart, { type: "tool" }>["state"]) {
  return state.status === "completed" ? state.output : ""
}

function getErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") return "Unknown error"
  if ("data" in error && error.data && typeof error.data === "object") {
    const message = (error.data as Record<string, unknown>)["message"]
    if (typeof message === "string") return message
  }
  if ("message" in error && typeof error.message === "string") return error.message
  return "Unknown error"
}

function requireSessionID(session: ApiSession | undefined, action: string) {
  const sessionID = session?.id
  if (!sessionID) throw new Error(`Failed to ${action} session`)
  return sessionID
}

// Local `withTimeout` that wraps a promise so post-timeout rejections
// don't become unhandled rejections and the timer is cleared as soon
// as the inner promise settles. The previous implementation used
// `Promise.race([p, new Promise((_, r) => setTimeout(r, ms))])` which
// leaked the timer for ms after p resolved *and* left p unhandled if
// it rejected after the timeout fired — the exact pathology the util
// package's `withTimeout` already documents and avoids. Keeping this
// one local so we can plug in a typed TimeoutError instead of the
// util's generic Error.
function withSdkTimeout<T>(
  promise: Promise<T>,
  ms: number,
  makeError: () => Error,
  onTimeout?: () => void,
): Promise<T> {
  let settled = false
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      onTimeout?.()
      try {
        reject(makeError())
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }, ms)
    if (typeof timer === "object" && "unref" in timer) timer.unref()
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

let logInitialized = false

async function ensureLog() {
  if (logInitialized) return
  logInitialized = true
  await Log.init({ print: false, dev: false, level: "ERROR" })
  process.env.AGENT = "1"
  process.env.AX_CODE = "1"
  process.env.OPENCODE = "1"
  process.env.AX_CODE_PID ??= String(process.pid)
}

// ============================================================
// ENV VAR AUTO-DETECTION (Enhancement #6)
// ============================================================

const ENV_VAR_MAP: Record<string, string> = {
  XAI_API_KEY: "xai",
  GEMINI_API_KEY: "google",
  GOOGLE_GENERATIVE_AI_API_KEY: "google",
  GOOGLE_API_KEY: "google",
}

const autoDetectLog = Log.create({ service: "sdk.auto-detect-auth" })

async function autoDetectAuth(): Promise<void> {
  for (const [envVar, provider] of Object.entries(ENV_VAR_MAP)) {
    const key = process.env[envVar]
    if (key) {
      const existing = await Auth.get(provider).catch(() => undefined)
      if (!existing) {
        // Log persistence failures — a silent catch previously let the
        // SDK run in-memory only and credentials would not survive a
        // restart with no indication of why.
        await Auth.set(provider, { type: "api", key }).catch((err) =>
          autoDetectLog.error("failed to persist auto-detected auth", { provider, envVar, err }),
        )
      }
    }
  }
}

// ============================================================
// STREAM HANDLE (Enhancement #2)
// ============================================================

function createStreamHandle(source: AsyncIterable<StreamEvent>): StreamHandle {
  const listeners: Record<string, Function[]> = {}
  let cachedResult: RunResult | undefined
  let iteratorStarted = false
  let resolveCompletion: (() => void) | undefined
  const completionPromise = new Promise<void>((r) => {
    resolveCompletion = r
  })

  async function* wrappedIterator(): AsyncGenerator<StreamEvent> {
    try {
      for await (const event of source) {
        // Fire registered callbacks
        if (event.type === "text" && listeners["text"]) {
          for (const cb of listeners["text"]) cb(event.text)
        }
        if (event.type === "tool-call" && listeners["tool-call"]) {
          for (const cb of listeners["tool-call"]) cb(event.tool, event.input)
        }
        if (event.type === "tool-result" && listeners["tool-result"]) {
          for (const cb of listeners["tool-result"]) cb(event.tool, event.output, event.status)
        }
        if (event.type === "reasoning" && listeners["reasoning"]) {
          for (const cb of listeners["reasoning"]) cb(event.text)
        }
        if (event.type === "error" && listeners["error"]) {
          for (const cb of listeners["error"]) cb(event.error)
        }
        if (event.type === "done") {
          cachedResult = event.result
          if (listeners["done"]) {
            for (const cb of listeners["done"]) cb(event.result)
          }
          yield event
          return
        }
        yield event
      }
    } finally {
      resolveCompletion?.()
    }
  }

  let generator: AsyncGenerator<StreamEvent> | undefined

  function ensureGenerator() {
    if (!generator) {
      generator = wrappedIterator()
    }
    return generator
  }

  const handle: StreamHandle = {
    [Symbol.asyncIterator]() {
      iteratorStarted = true
      return ensureGenerator()
    },

    async text(): Promise<string> {
      for await (const event of handle) {
        if (event.type === "done") return event.result.text
      }
      return ""
    },

    async result(): Promise<RunResult> {
      if (cachedResult) return cachedResult
      for await (const event of handle) {
        if (event.type === "done") return event.result
      }
      throw new Error("Stream ended without a result")
    },

    on(event: string, callback: Function): StreamHandle {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(callback)
      return handle
    },

    async done(): Promise<void> {
      if (!iteratorStarted) {
        // Consume the iterator to trigger callbacks
        for await (const event of handle) {
          if (event.type === "done") break
        }
        return
      }
      return completionPromise
    },
  }

  return handle
}

// ============================================================
// RETRY LOGIC (Enhancement #3)
// ============================================================

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  onRetry?: (attempt: number, error: Error) => void,
): Promise<T> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      const isRetryable = (() => {
        if (e instanceof ProviderError) {
          return e.status !== undefined && [429, 500, 502, 503, 504].includes(e.status)
        }
        // Fallback string matching for non-classified errors
        return (
          lastError!.message.includes("ECONNRESET") ||
          lastError!.message.includes("ECONNREFUSED") ||
          lastError!.message.includes("ENOTFOUND") ||
          lastError!.message.includes("ETIMEDOUT") ||
          lastError!.message.includes("rate limit") ||
          lastError!.message.includes("network") ||
          lastError!.message.includes("socket hang up")
        )
      })()

      if (!isRetryable || attempt === maxRetries) throw lastError

      if (onRetry) onRetry(attempt + 1, lastError)
      // Exponential backoff: 1s, 2s, 4s — unref timer to avoid blocking process exit
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt), 8000))
        if (typeof timer === "object" && "unref" in timer) timer.unref()
      })
    }
  }
  throw lastError
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal, onAbort?: () => void): Promise<T> {
  if (signal.aborted) {
    onAbort?.()
    return Promise.reject(new Error("Operation aborted"))
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort)
      onAbort?.()
      reject(new Error("Operation aborted"))
    }
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (err) => {
        signal.removeEventListener("abort", abort)
        reject(err)
      },
    )
  })
}

// ============================================================
// ERROR CLASSIFICATION (Enhancement #1)
// ============================================================

function classifyError(errMsg: string): Error {
  const lower = errMsg.toLowerCase()

  // Agent not found
  const agentMatch = errMsg.match(/Agent not found: "(.+?)"\. Available: (.+)/)
  if (agentMatch) {
    return new AgentNotFoundError(agentMatch[1], agentMatch[2].split(", "))
  }

  // Provider errors (with i18n messages)
  if (lower.includes("rate limit") || lower.includes("429")) {
    return new ProviderError(t("errors.rateLimited"), { status: 429 })
  }
  if (lower.includes("unauthorized") || lower.includes("401") || lower.includes("invalid api key")) {
    return new ProviderError(t("errors.apiError"), { status: 401 })
  }
  if (lower.includes("500") || lower.includes("internal server error")) {
    return new ProviderError(t("errors.apiError"), { status: 500 })
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return new ProviderError(t("errors.timeout"), { status: 408 })
  }
  if (lower.includes("permission") || lower.includes("forbidden")) {
    return new ProviderError(t("errors.permissionDenied"), { status: 403 })
  }
  if (lower.includes("not found") && lower.includes("file")) {
    return new ProviderError(t("errors.fileNotFound"), { status: 404 })
  }
  if (lower.includes("connection") || lower.includes("econnrefused")) {
    return new ProviderError(t("errors.connectionFailed"), { status: 0 })
  }

  // Tool errors
  const toolMatch = errMsg.match(/Tool "(.+?)" failed: (.+)/)
  if (toolMatch) {
    return new ToolError(toolMatch[1], toolMatch[2])
  }

  // Unclassified errors default to ProviderError so callers can at
  // least narrow on `instanceof ProviderError`. A generic `Error`
  // forced users to fall through to a catch-all with no retry path.
  return new ProviderError(errMsg, { status: 0 })
}

// ============================================================
// SDK TOOL → INTERNAL TOOL ADAPTER
// ============================================================

// Converts a user-defined `SdkTool` (from the SDK's `tool()` helper)
// into an internal `Tool.Info` that the `ToolRegistry` accepts. The
// adapter mirrors `fromPlugin` in `tool/registry.ts` — same shape,
// same contract, but sourced from the programmatic SDK surface
// instead of a config-directory `.ts` file or a plugin module.
//
// The user's `execute` function returns any JSON-serializable value;
// we stringify it as the `output` field the LLM sees. If the user
// throws, the error propagates through the normal tool-error path
// in the session processor and gets classified as a `ToolError` in
// the SDK's event stream.

function fromSdkTool(sdkTool: SdkTool): Tool.Info {
  const parameters = sdkTool.parameters as z.ZodType<unknown>
  return {
    id: sdkTool.name,
    init: async () => ({
      description: sdkTool.description,
      parameters,
      async execute(args: unknown) {
        const result = await sdkTool.execute(args)
        let output: string
        if (typeof result === "string") {
          output = result
        } else if (result === undefined || result === null) {
          output = ""
        } else {
          try {
            output = JSON.stringify(result, null, 2)
          } catch {
            output = "[Tool returned a non-serializable value]"
          }
        }
        return {
          title: `${sdkTool.name} result`,
          output,
          metadata: {},
        }
      },
    }),
  }
}

// ============================================================
// IN-PROCESS CLIENT
// ============================================================

function createInProcessClient(directory: string): OpencodeClient {
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    return Server.Default().fetch(request)
  }) as typeof globalThis.fetch

  return createOpencodeClient({
    baseUrl: internalBaseUrl(),
    fetch: fetchFn,
    directory,
  })
}

// ============================================================
// EVENT COLLECTION
// ============================================================

type EventStream = Awaited<ReturnType<OpencodeClient["event"]["subscribe"]>>

async function closeEvents(events: EventStream) {
  await events.stream.return?.(undefined)
}

async function collectResult(
  sdk: OpencodeClient,
  events: EventStream,
  sessionID: string,
  hooks?: AgentOptions["hooks"],
): Promise<RunResult> {
  const toolCalls: ToolCallInfo[] = []
  let text = ""
  let agent = ""
  let modelInfo = { providerID: "", modelID: "" }
  let messageID = ""
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  try {
    for await (const event of events.stream) {
      if (event.type === "message.updated") {
        const info = event.properties.info
        if (info.role === "assistant") {
          agent = info.agent ?? ""
          modelInfo = { providerID: info.providerID ?? "", modelID: info.modelID ?? "" }
          messageID = info.id
        }
      }

      if (event.type === "message.part.updated") {
        const part = event.properties.part
        if (part.sessionID !== sessionID) continue

        if (part.type === "text" && part.time?.end) {
          text = part.text ?? ""
        }

        if (part.type === "tool") {
          if (part.state.status === "running" && hooks?.onToolCall) {
            await hooks.onToolCall(part.tool, part.state.input)
          }
          if (part.state.status === "completed" || part.state.status === "error") {
            toolCalls.push({
              tool: part.tool,
              input: part.state.input,
              output: getToolOutput(part.state),
              status: part.state.status,
            })
            if (hooks?.onToolResult) {
              await hooks.onToolResult(part.tool, getToolOutput(part.state))
            }
          }
        }
      }

      if (event.type === "session.error") {
        const err = classifyError(getErrorMessage(event.properties.error))
        if (hooks?.onError) hooks.onError(err)
        throw err
      }

      if (event.type === "permission.asked") {
        const perm = event.properties
        if (perm.sessionID !== sessionID) continue
        const hookReply = hooks?.onPermissionRequest
          ? await hooks.onPermissionRequest({ id: perm.id, permission: perm.permission, patterns: perm.patterns })
          : "deny"
        const reply = hookReply === "allow" ? "once" : "reject"
        await sdk.permission.reply({ requestID: perm.id, reply })
      }

      if (event.type === "session.status") {
        const props = event.properties
        if (props.sessionID === sessionID && props.status.type === "idle") {
          const msgs = await sdk.session.messages({ sessionID })
          usage = getSessionUsage(lastAssistantMessage(msgs.data))
          break
        }
      }
    }
  } finally {
    await closeEvents(events)
  }

  return { text, agent, model: modelInfo, usage, toolCalls, sessionID, messageID }
}

async function* streamEvents(
  sdk: OpencodeClient,
  events: EventStream,
  sessionID: string,
  hooks?: AgentOptions["hooks"],
): AsyncGenerator<StreamEvent> {
  const toolCalls: ToolCallInfo[] = []
  let text = ""
  let agent = ""
  let modelInfo = { providerID: "", modelID: "" }
  let messageID = ""
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  for await (const event of events.stream) {
    if (event.type === "message.updated") {
      const info = event.properties.info
      if (info.role === "assistant") {
        agent = info.agent ?? ""
        modelInfo = { providerID: info.providerID ?? "", modelID: info.modelID ?? "" }
        messageID = info.id
      }
    }

    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.sessionID !== sessionID) continue

      if (part.type === "text") {
        const currentText = part.text ?? ""
        // Emit only the delta since the last update. Use string
        // content comparison (not just length) so edits that shrink
        // the text don't silently drop the new content. The slice
        // is safe: if the new text is shorter than `text`, the
        // delta is empty and we still update `text` to reflect
        // the latest state.
        if (currentText !== text) {
          if (currentText.startsWith(text)) {
            const delta = currentText.slice(text.length)
            if (delta.length > 0) yield { type: "text", text: delta }
          } else {
            // Content was edited (not just appended) — emit full replacement
            yield { type: "text", text: currentText }
          }
          text = currentText
        }
      }

      if (part.type === "reasoning") {
        yield { type: "reasoning", text: part.text ?? "" }
      }

      if (part.type === "step-start") {
        yield { type: "step-start", index: 0 }
      }

      if (part.type === "step-finish") {
        yield { type: "step-finish", index: 0 }
      }

      if (part.type === "tool") {
        if (part.state.status === "running") {
          yield { type: "tool-call", tool: part.tool, input: part.state.input, id: part.id }
          if (hooks?.onToolCall) await hooks.onToolCall(part.tool, part.state.input)
        }
        if (part.state.status === "completed" || part.state.status === "error") {
          toolCalls.push({
            tool: part.tool,
            input: part.state.input,
            output: getToolOutput(part.state),
            status: part.state.status,
          })
          yield {
            type: "tool-result",
            tool: part.tool,
            output: getToolOutput(part.state),
            id: part.id,
            status: part.state.status,
          }
          if (hooks?.onToolResult) await hooks.onToolResult(part.tool, getToolOutput(part.state))
        }
      }
    }

    if (event.type === "session.error") {
      const err = classifyError(getErrorMessage(event.properties.error))
      if (hooks?.onError) hooks.onError(err)
      yield { type: "error", error: err }
      return
    }

    if (event.type === "permission.asked") {
      const perm = event.properties
      if (perm.sessionID !== sessionID) continue
      const hookReply = hooks?.onPermissionRequest
        ? await hooks.onPermissionRequest({ id: perm.id, permission: perm.permission, patterns: perm.patterns })
        : "deny"
      const reply = hookReply === "allow" ? "once" : "reject"
      await sdk.permission.reply({ requestID: perm.id, reply })
    }

    if (event.type === "session.status") {
      const props = event.properties
      if (props.sessionID === sessionID && props.status.type === "idle") {
        const msgs = await sdk.session.messages({ sessionID })
        const lastAssistant = lastAssistantMessage(msgs.data)
        usage = getSessionUsage(lastAssistant)
        // Get the final text from the stored message parts (not streamed text which may have echoes)
        text = getFinalAssistantText(lastAssistant) ?? text
        yield { type: "done", result: { text, agent, model: modelInfo, usage, toolCalls, sessionID, messageID } }
        return
      }
    }
  }
}

// ============================================================
// SESSION HANDLE
// ============================================================

function createSessionHandle(
  sdk: OpencodeClient,
  sessionID: string,
  opts: AgentOptions,
  isDisposed?: () => boolean,
): SessionHandle {
  return {
    get id() {
      return sessionID
    },

    async run(message: string, options?: RunOptions): Promise<RunResult> {
      const model =
        options?.model ?? (opts.model && opts.provider ? { providerID: opts.provider, modelID: opts.model } : undefined)

      const collect = async () => {
        const events = await sdk.event.subscribe()
        const result = collectResult(sdk, events, sessionID, opts.hooks)
        try {
          await sdk.session.prompt({
            sessionID,
            agent: options?.agent ?? opts.agent,
            model,
            variant: options?.variant ?? opts.variant,
            parts: [{ type: "text", text: message }],
          })
        } catch (err) {
          await closeEvents(events)
          throw err instanceof Error ? err : new Error(String(err))
        }
        return result
      }
      const resultPromise = opts.maxRetries ? withRetry(collect, opts.maxRetries, opts.hooks?.onRetry) : collect()
      const abortable = options?.signal
        ? withAbort(resultPromise, options.signal, () => {
            void sdk.session.abort({ sessionID }).catch(() => {})
          })
        : resultPromise

      if (options?.timeout) {
        const timeoutMs = options.timeout
        return withSdkTimeout(abortable, timeoutMs, () => new TimeoutError(timeoutMs, "agent.run"))
      }
      return abortable
    },

    stream(message: string, options?: RunOptions): StreamHandle {
      const model =
        options?.model ?? (opts.model && opts.provider ? { providerID: opts.provider, modelID: opts.model } : undefined)
      const rawStream = (async function* () {
        const events = await sdk.event.subscribe()
        if (options?.signal?.aborted) {
          await closeEvents(events)
          return
        }
        const abort = () => {
          void sdk.session.abort({ sessionID }).catch(() => {})
        }
        options?.signal?.addEventListener("abort", abort, { once: true })
        try {
          await sdk.session.prompt({
            sessionID,
            agent: options?.agent ?? opts.agent,
            model,
            variant: options?.variant ?? opts.variant,
            parts: [{ type: "text", text: message }],
          })
        } catch (err) {
          await closeEvents(events)
          yield { type: "error", error: err instanceof Error ? err : new Error(String(err)) } satisfies StreamEvent
          return
        }
        try {
          yield* streamEvents(sdk, events, sessionID, opts.hooks)
        } finally {
          options?.signal?.removeEventListener("abort", abort)
          await closeEvents(events)
        }
      })()
      return createStreamHandle(rawStream)
    },

    async messages() {
      const result = await sdk.session.messages({ sessionID })
      return result.data ?? []
    },

    async fork(): Promise<SessionHandle> {
      if (isDisposed?.()) throw new DisposedError()
      const result = await sdk.session.fork({ sessionID })
      return createSessionHandle(sdk, requireSessionID(result.data, "fork"), opts, isDisposed)
    },

    async abort() {
      if (isDisposed?.()) throw new DisposedError()
      await sdk.session.abort({ sessionID })
    },
  }
}

// ============================================================
// CREATE AGENT (main entry point)
// ============================================================

/**
 * Create an agent that runs in-process without an HTTP server.
 *
 * @example
 * ```typescript
 * // Basic usage (uses local config)
 * const agent = await createAgent({ directory: process.cwd() })
 *
 * // With direct API key (no local config needed)
 * const agent = await createAgent({
 *   directory: process.cwd(),
 *   auth: { provider: "xai", apiKey: "xai-abc123" },
 * })
 *
 * // With retry and timeout
 * const agent = await createAgent({
 *   directory: process.cwd(),
 *   maxRetries: 3,
 *   timeout: 10000,
 * })
 * ```
 */
export async function createAgent(options?: AgentOptions): Promise<Agent> {
  const opts = { directory: process.cwd(), ...options }
  await ensureLog()

  let sdk: OpencodeClient
  let disposed = false
  // `bootstrap()` wraps its callback in `Instance.provide(...)` which
  // tears down the Instance in a `finally` block. That means the
  // callback must not return until the user is done with the agent,
  // otherwise the Instance (LSP clients, DB, watchers, etc.) gets
  // disposed while the agent is still in use. We hold the callback
  // open by awaiting `keepAlive` here and resolving it from dispose().
  // The previous implementation polled `disposed` every 100ms with
  // `setTimeout(check, 100)` — wasting wake-ups for the entire
  // lifetime of every agent and keeping the event loop busy even
  // when nothing was happening. Resolving the promise directly from
  // dispose() lets the runtime sleep.
  let resolveKeepAlive!: () => void
  const keepAlive = new Promise<void>((r) => {
    resolveKeepAlive = r
  })

  const initPromise = new Promise<void>((resolve, reject) => {
    bootstrap(opts.directory, async () => {
      // Set language for error messages
      if (opts.language === "en") {
        setLanguage(opts.language)
      }

      // Enhancement #5: Direct API key auth
      if (opts.auth) {
        await Auth.set(opts.auth.provider, { type: "api", key: opts.auth.apiKey })
      }

      // Enhancement #6: Auto-detect env vars
      await autoDetectAuth()

      // Register user-defined tools before the SDK client is created
      // so they appear in the tool registry when the first session
      // prompt is sent. Uses the same adapter pattern as the plugin
      // tool loader in registry.ts:fromPlugin — the ToolRegistry
      // already has a public `register(tool: Tool.Info)` method, so
      // this is pure plumbing.
      //
      // All registrations must complete BEFORE resolve() fires —
      // otherwise the first prompt can race against a pending
      // registration and the LLM won't see the user's tools.
      if (opts.tools?.length) {
        const results = await Promise.allSettled(opts.tools.map((t) => ToolRegistry.register(fromSdkTool(t))))
        for (const [i, r] of results.entries()) {
          if (r.status === "rejected")
            Log.Default.warn("failed to register SDK tool", { tool: opts.tools[i].name, err: r.reason })
        }
      }

      sdk = createInProcessClient(opts.directory)
      resolve()

      // Block the bootstrap callback until dispose() is called so
      // `Instance.provide`'s finally-block teardown is deferred.
      await keepAlive
    }).catch(reject)
  })

  // Enhancement #4: Timeout on createAgent
  if (opts.timeout) {
    const timeoutMs = opts.timeout
    await withSdkTimeout(
      initPromise,
      timeoutMs,
      () => new TimeoutError(timeoutMs, "createAgent"),
      () => {
        resolveKeepAlive()
      },
    )
  } else {
    await initPromise
  }

  return {
    async run(message: string, runOptions?: RunOptions): Promise<RunResult> {
      if (disposed) throw new DisposedError()
      const exec = async () => {
        const session = await sdk.session.create()
        const sessionID = requireSessionID(session.data, "create")
        return createSessionHandle(sdk, sessionID, opts, () => disposed).run(message, runOptions)
      }
      if (runOptions?.timeout) {
        const timeoutMs = runOptions.timeout
        return withSdkTimeout(exec(), timeoutMs, () => new TimeoutError(timeoutMs, "agent.run"))
      }
      return exec()
    },

    stream(message: string, runOptions?: RunOptions): StreamHandle {
      if (disposed) throw new DisposedError()
      const rawIterable: AsyncIterable<StreamEvent> = {
        [Symbol.asyncIterator]() {
          let gen: AsyncIterator<StreamEvent> | undefined
          let started = false
          return {
            async next() {
              if (!started) {
                started = true
                const session = await sdk.session.create()
                const sessionID = requireSessionID(session.data, "create")
                gen = createSessionHandle(sdk, sessionID, opts, () => disposed)
                  .stream(message, runOptions)
                  [Symbol.asyncIterator]()
              }
              return gen!.next()
            },
            async return(v?: unknown) {
              return gen?.return?.(v) ?? { done: true as const, value: undefined }
            },
            async throw(e?: unknown) {
              return gen?.throw?.(e) ?? { done: true as const, value: undefined }
            },
          }
        },
      }
      return createStreamHandle(rawIterable)
    },

    async session(): Promise<SessionHandle> {
      if (disposed) throw new DisposedError()
      const session = await sdk.session.create()
      const sessionID = requireSessionID(session.data, "create")
      return createSessionHandle(sdk, sessionID, opts, () => disposed)
    },

    async tool(name: string, input: Record<string, unknown>): Promise<unknown> {
      if (disposed) throw new DisposedError()
      const toolsList = await sdk.tool.ids()
      const available = toolsList.data ?? []
      if (!available.includes(name)) {
        throw new ToolError(name, `Not found. Available: ${available.join(", ")}`)
      }
      const session = await sdk.session.create()
      const sessionID = requireSessionID(session.data, "create")
      const events = await sdk.event.subscribe()
      const resultPromise = collectResult(sdk, events, sessionID, opts.hooks)
      try {
        await sdk.session.prompt({
          sessionID,
          agent: "build",
          parts: [
            {
              type: "text",
              text: `Use the ${name} tool with these arguments: ${JSON.stringify(input)}. Only use this one tool, nothing else.`,
            },
          ],
        })
      } catch (err) {
        await closeEvents(events)
        throw err instanceof Error ? err : new Error(String(err))
      }
      const result = await resultPromise
      const toolResult = result.toolCalls.find((t) => t.tool === name)
      return toolResult?.output ?? result.text
    },

    // Enhancement #7: Discovery methods
    async models(): Promise<string[]> {
      if (disposed) throw new DisposedError()
      const resp = await sdk.config.providers()
      const providers: ApiProvider[] = resp.data?.providers ?? []
      const models: string[] = []
      for (const provider of providers) {
        for (const modelID of Object.keys(provider.models)) {
          models.push(`${provider.id}/${modelID}`)
        }
      }
      return models.sort()
    },

    async tools(): Promise<string[]> {
      if (disposed) throw new DisposedError()
      const result = await sdk.tool.ids()
      return result.data ?? []
    },

    async dispose() {
      if (disposed) return
      disposed = true
      // Unblock the keep-alive promise so bootstrap()'s callback
      // returns and `Instance.provide` runs its finally-block
      // teardown (LSP shutdown, DB close, watcher cleanup, etc.).
      resolveKeepAlive()
    },
  }
}
