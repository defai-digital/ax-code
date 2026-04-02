/**
 * ax-code Programmatic SDK entry point
 *
 * This file lives inside the ax-code package to avoid import resolution
 * issues. It initializes Log and then exposes the agent API.
 *
 * Usage from SDK:
 *   import { createAgent } from "ax-code/sdk/programmatic"
 */

import { Log } from "../util/log"
import { bootstrap } from "../cli/bootstrap"
import { Server } from "../server/server"
import { Auth } from "../auth"
import { setLanguage, t } from "../i18n"
import { createOpencodeClient } from "@ax-code/sdk/v2/client"
import type { OpencodeClient } from "@ax-code/sdk/v2/client"
import type {
  Agent,
  AgentOptions,
  RunOptions,
  RunResult,
  StreamEvent,
  StreamHandle,
  SessionHandle,
  ToolCallInfo,
} from "../../../sdk/js/src/programmatic/types.ts"
import {
  DisposedError,
  TimeoutError,
  AgentNotFoundError,
  ProviderError,
  ToolError,
} from "../../../sdk/js/src/programmatic/types.ts"

// Re-export error classes so they can be imported from this module
export {
  AxCodeError,
  ProviderError,
  TimeoutError,
  ToolError,
  PermissionError,
  AgentNotFoundError,
  DisposedError,
} from "../../../sdk/js/src/programmatic/types.ts"

let logInitialized = false

async function ensureLog() {
  if (logInitialized) return
  logInitialized = true
  await Log.init({ print: false, dev: false, level: "ERROR" })
  process.env.AGENT = "1"
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
  GROQ_API_KEY: "groq",
}

async function autoDetectAuth(): Promise<void> {
  for (const [envVar, provider] of Object.entries(ENV_VAR_MAP)) {
    const key = process.env[envVar]
    if (key) {
      const existing = await Auth.get(provider).catch(() => undefined)
      if (!existing) {
        await Auth.set(provider, { type: "api", key }).catch(() => {})
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
  const completionPromise = new Promise<void>((r) => { resolveCompletion = r })

  async function* wrappedIterator(): AsyncGenerator<StreamEvent> {
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
        resolveCompletion?.()
        yield event
        return
      }
      yield event
    }
    resolveCompletion?.()
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
      // Exponential backoff: 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 8000)))
    }
  }
  throw lastError
}

// ============================================================
// ERROR CLASSIFICATION (Enhancement #1)
// ============================================================

function classifyError(errMsg: string, rawError?: any): Error {
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

  return new Error(errMsg)
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
    baseUrl: "http://opencode.internal",
    fetch: fetchFn,
    directory,
  })
}

// ============================================================
// EVENT COLLECTION
// ============================================================

async function collectResult(
  sdk: OpencodeClient,
  sessionID: string,
  hooks?: AgentOptions["hooks"],
): Promise<RunResult> {
  const events = await sdk.event.subscribe()
  const toolCalls: ToolCallInfo[] = []
  let text = ""
  let agent = ""
  let modelInfo = { providerID: "", modelID: "" }
  let messageID = ""
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  for await (const event of events.stream) {
    if (event.type === "message.updated") {
      const info = (event as any).properties.info
      if (info.role === "assistant") {
        agent = info.agent ?? ""
        modelInfo = { providerID: info.providerID ?? "", modelID: info.modelID ?? "" }
        messageID = info.id
      }
    }

    if (event.type === "message.part.updated") {
      const part = (event as any).properties.part
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
            output: part.state.output ?? "",
            status: part.state.status,
          })
          if (hooks?.onToolResult) {
            await hooks.onToolResult(part.tool, part.state.output ?? "")
          }
        }
      }
    }

    if (event.type === "session.error") {
      const errProps = (event as any).properties.error
      const errMsg = errProps?.data?.message ?? errProps?.message ?? "Unknown error"
      const err = classifyError(errMsg, errProps)
      if (hooks?.onError) hooks.onError(err)
      throw err
    }

    if (event.type === "permission.asked") {
      const perm = (event as any).properties
      if (perm.sessionID !== sessionID) continue
      const hookReply = hooks?.onPermissionRequest
        ? await hooks.onPermissionRequest({ id: perm.id, permission: perm.permission, patterns: perm.patterns })
        : "deny"
      const reply = hookReply === "allow" ? "once" : "reject"
      await sdk.permission.reply({ requestID: perm.id, reply })
    }

    if (event.type === "session.status") {
      const props = (event as any).properties
      if (props.sessionID === sessionID && props.status.type === "idle") {
        const msgs = await sdk.session.messages({ sessionID })
        const lastAssistant = (msgs.data as any[])?.findLast((m: any) => m.info?.role === "assistant")
        if (lastAssistant?.info?.tokens) {
          const t = lastAssistant.info.tokens
          usage = {
            promptTokens: t.input ?? 0,
            completionTokens: t.output ?? 0,
            totalTokens: t.total ?? ((t.input ?? 0) + (t.output ?? 0)),
          }
        }
        break
      }
    }
  }

  return { text, agent, model: modelInfo, usage, toolCalls, sessionID, messageID }
}

async function* streamEvents(
  sdk: OpencodeClient,
  sessionID: string,
  hooks?: AgentOptions["hooks"],
): AsyncGenerator<StreamEvent> {
  const events = await sdk.event.subscribe()
  const toolCalls: ToolCallInfo[] = []
  let text = ""
  let agent = ""
  let modelInfo = { providerID: "", modelID: "" }
  let messageID = ""
  let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  let lastTextLength = 0

  for await (const event of events.stream) {
    if (event.type === "message.updated") {
      const info = (event as any).properties.info
      if (info.role === "assistant") {
        agent = info.agent ?? ""
        modelInfo = { providerID: info.providerID ?? "", modelID: info.modelID ?? "" }
        messageID = info.id
      }
    }

    if (event.type === "message.part.updated") {
      const part = (event as any).properties.part
      if (part.sessionID !== sessionID) continue

      if (part.type === "text") {
        const currentText = part.text ?? ""
        if (currentText.length > lastTextLength) {
          yield { type: "text", text: currentText.slice(lastTextLength) }
          lastTextLength = currentText.length
          text = currentText
        }
      }

      if (part.type === "reasoning") {
        yield { type: "reasoning", text: part.text ?? "" }
      }

      if (part.type === "step-start") {
        yield { type: "step-start", index: part.step ?? 0 }
      }

      if (part.type === "step-finish") {
        yield { type: "step-finish", index: part.step ?? 0 }
      }

      if (part.type === "tool") {
        if (part.state.status === "running" && !part.state.output) {
          yield { type: "tool-call", tool: part.tool, input: part.state.input, id: part.id }
          if (hooks?.onToolCall) await hooks.onToolCall(part.tool, part.state.input)
        }
        if (part.state.status === "completed" || part.state.status === "error") {
          toolCalls.push({
            tool: part.tool,
            input: part.state.input,
            output: part.state.output ?? "",
            status: part.state.status,
          })
          yield { type: "tool-result", tool: part.tool, output: part.state.output ?? "", id: part.id, status: part.state.status }
          if (hooks?.onToolResult) await hooks.onToolResult(part.tool, part.state.output ?? "")
        }
      }
    }

    if (event.type === "session.error") {
      const errProps = (event as any).properties.error
      const errMsg = errProps?.data?.message ?? errProps?.message ?? "Unknown error"
      const err = classifyError(errMsg, errProps)
      if (hooks?.onError) hooks.onError(err)
      yield { type: "error", error: err }
      return
    }

    if (event.type === "permission.asked") {
      const perm = (event as any).properties
      if (perm.sessionID !== sessionID) continue
      const hookReply = hooks?.onPermissionRequest
        ? await hooks.onPermissionRequest({ id: perm.id, permission: perm.permission, patterns: perm.patterns })
        : "deny"
      const reply = hookReply === "allow" ? "once" : "reject"
      await sdk.permission.reply({ requestID: perm.id, reply })
    }

    if (event.type === "session.status") {
      const props = (event as any).properties
      if (props.sessionID === sessionID && props.status.type === "idle") {
        const msgs = await sdk.session.messages({ sessionID })
        const lastAssistant = (msgs.data as any[])?.findLast((m: any) => m.info?.role === "assistant")
        if (lastAssistant?.info?.tokens) {
          const t = lastAssistant.info.tokens
          usage = {
            promptTokens: t.input ?? 0,
            completionTokens: t.output ?? 0,
            totalTokens: t.total ?? ((t.input ?? 0) + (t.output ?? 0)),
          }
        }
        // Get the final text from the stored message parts (not streamed text which may have echoes)
        if (lastAssistant?.parts) {
          const textPart = (lastAssistant.parts as any[]).findLast((p: any) => p.type === "text" && p.text)
          if (textPart?.text) text = textPart.text
        }
        yield { type: "done", result: { text, agent, model: modelInfo, usage, toolCalls, sessionID, messageID } }
        return
      }
    }
  }
}

// ============================================================
// SESSION HANDLE
// ============================================================

function createSessionHandle(sdk: OpencodeClient, sessionID: string, opts: AgentOptions): SessionHandle {
  return {
    get id() { return sessionID },

    async run(message: string, options?: RunOptions): Promise<RunResult> {
      const model = options?.model ?? (opts.model && opts.provider ? { providerID: opts.provider, modelID: opts.model } : undefined)

      const exec = () => {
        const resultPromise = collectResult(sdk, sessionID, opts.hooks)
        sdk.session.prompt({
          sessionID,
          agent: options?.agent ?? opts.agent,
          model,
          variant: options?.variant ?? opts.variant,
          parts: [{ type: "text", text: message }],
        })
        return resultPromise
      }

      const resultPromise = opts.maxRetries
        ? withRetry(exec, opts.maxRetries, opts.hooks?.onRetry)
        : exec()

      if (options?.timeout) {
        return Promise.race([
          resultPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new TimeoutError(options.timeout!, "agent.run")), options.timeout),
          ),
        ])
      }
      return resultPromise
    },

    stream(message: string, options?: RunOptions): StreamHandle {
      const model = options?.model ?? (opts.model && opts.provider ? { providerID: opts.provider, modelID: opts.model } : undefined)
      const rawStream = streamEvents(sdk, sessionID, opts.hooks)
      sdk.session.prompt({
        sessionID,
        agent: options?.agent ?? opts.agent,
        model,
        variant: options?.variant ?? opts.variant,
        parts: [{ type: "text", text: message }],
      })
      return createStreamHandle(rawStream)
    },

    async messages() {
      const result = await sdk.session.messages({ sessionID })
      return result.data ?? []
    },

    async fork(): Promise<SessionHandle> {
      const result = await sdk.session.fork({ sessionID })
      const newID = (result.data as any)?.id
      if (!newID) throw new Error("Failed to fork session")
      return createSessionHandle(sdk, newID, opts)
    },

    async abort() {
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
export async function createAgent(options: AgentOptions): Promise<Agent> {
  await ensureLog()

  let sdk: OpencodeClient
  let disposed = false

  const initPromise = new Promise<void>((resolve, reject) => {
    bootstrap(options.directory, async () => {
      // Set language for error messages
      if (options.language) {
        setLanguage(options.language)
      }

      // Enhancement #5: Direct API key auth
      if (options.auth) {
        await Auth.set(options.auth.provider, { type: "api", key: options.auth.apiKey })
      }

      // Enhancement #6: Auto-detect env vars
      await autoDetectAuth()

      sdk = createInProcessClient(options.directory)
      resolve()

      // Keep alive until dispose()
      await new Promise<void>((r) => {
        const check = () => { if (disposed) return r(); setTimeout(check, 100) }
        check()
      })
    }).catch(reject)
  })

  // Enhancement #4: Timeout on createAgent
  if (options.timeout) {
    await Promise.race([
      initPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new TimeoutError(options.timeout!, "createAgent")), options.timeout),
      ),
    ])
  } else {
    await initPromise
  }

  return {
    async run(message: string, runOptions?: RunOptions): Promise<RunResult> {
      if (disposed) throw new DisposedError()
      const exec = async () => {
        const session = await sdk.session.create()
        const sessionID = (session.data as any)?.id
        if (!sessionID) throw new Error("Failed to create session")
        return createSessionHandle(sdk, sessionID, options).run(message, runOptions)
      }
      if (runOptions?.timeout) {
        return Promise.race([
          exec(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new TimeoutError(runOptions.timeout!, "agent.run")), runOptions.timeout),
          ),
        ])
      }
      return exec()
    },

    stream(message: string, runOptions?: RunOptions): StreamHandle {
      if (disposed) throw new DisposedError()
      const rawIterable: AsyncIterable<StreamEvent> = {
        [Symbol.asyncIterator]() {
          let gen: AsyncGenerator<StreamEvent> | undefined
          let started = false
          return {
            async next() {
              if (!started) {
                started = true
                const session = await sdk.session.create()
                const sessionID = (session.data as any)?.id
                if (!sessionID) throw new Error("Failed to create session")
                gen = createSessionHandle(sdk, sessionID, options).stream(message, runOptions)[Symbol.asyncIterator]() as AsyncGenerator<StreamEvent>
              }
              return gen!.next()
            },
            async return(v?: any) { return gen?.return?.(v) ?? { done: true as const, value: undefined } },
            async throw(e?: any) { return gen?.throw?.(e) ?? { done: true as const, value: undefined } },
          }
        },
      }
      return createStreamHandle(rawIterable)
    },

    async session(): Promise<SessionHandle> {
      if (disposed) throw new DisposedError()
      const session = await sdk.session.create()
      const sessionID = (session.data as any)?.id
      if (!sessionID) throw new Error("Failed to create session")
      return createSessionHandle(sdk, sessionID, options)
    },

    async tool(name: string, input: Record<string, unknown>): Promise<unknown> {
      if (disposed) throw new DisposedError()
      const toolsList = await sdk.tool.ids()
      const available = toolsList.data as string[] ?? []
      if (!available.includes(name)) {
        throw new ToolError(name, `Not found. Available: ${available.join(", ")}`)
      }
      const session = await sdk.session.create()
      const sessionID = (session.data as any)?.id
      if (!sessionID) throw new Error("Failed to create session")
      const resultPromise = collectResult(sdk, sessionID, options.hooks)
      await sdk.session.prompt({
        sessionID,
        agent: "build",
        parts: [{ type: "text", text: `Use the ${name} tool with these arguments: ${JSON.stringify(input)}. Only use this one tool, nothing else.` }],
      })
      const result = await resultPromise
      const toolResult = result.toolCalls.find((t) => t.tool === name)
      return toolResult?.output ?? result.text
    },

    // Enhancement #7: Discovery methods
    async models(): Promise<string[]> {
      if (disposed) throw new DisposedError()
      const resp = await sdk.config.providers()
      const wrapper = resp.data as any ?? {}
      const providers = Array.isArray(wrapper.providers) ? wrapper.providers : []
      const models: string[] = []
      for (const provider of providers) {
        if (provider?.id && provider?.models && typeof provider.models === "object") {
          for (const modelID of Object.keys(provider.models)) {
            models.push(`${provider.id}/${modelID}`)
          }
        }
      }
      return models.sort()
    },

    async tools(): Promise<string[]> {
      if (disposed) throw new DisposedError()
      const result = await sdk.tool.ids()
      return (result.data as string[]) ?? []
    },

    async dispose() {
      disposed = true
    },
  }
}
