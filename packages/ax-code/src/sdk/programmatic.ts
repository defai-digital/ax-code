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
import { createOpencodeClient } from "@ax-code/sdk/v2/client"
import type { OpencodeClient } from "@ax-code/sdk/v2/client"
import type {
  Agent,
  AgentOptions,
  RunOptions,
  RunResult,
  StreamEvent,
  SessionHandle,
  ToolCallInfo,
} from "@ax-code/sdk/programmatic"

let logInitialized = false

async function ensureLog() {
  if (logInitialized) return
  logInitialized = true
  await Log.init({ print: false, dev: false, level: "ERROR" })
  process.env.AGENT = "1"
  process.env.OPENCODE = "1"
  process.env.AX_CODE_PID ??= String(process.pid)
}

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
      const err = new Error(errMsg)
      if (hooks?.onError) hooks.onError(err)
      throw err
    }

    if (event.type === "permission.asked") {
      const perm = (event as any).properties
      if (perm.sessionID !== sessionID) continue
      const reply = hooks?.onPermissionRequest
        ? await hooks.onPermissionRequest({ id: perm.id, permission: perm.permission, patterns: perm.patterns })
        : "deny"
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
      const err = new Error((event as any).properties.error?.message ?? "Unknown error")
      if (hooks?.onError) hooks.onError(err)
      yield { type: "error", error: err }
      return
    }

    if (event.type === "permission.asked") {
      const perm = (event as any).properties
      if (perm.sessionID !== sessionID) continue
      const reply = hooks?.onPermissionRequest
        ? await hooks.onPermissionRequest({ id: perm.id, permission: perm.permission, patterns: perm.patterns })
        : "deny"
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
        yield { type: "done", result: { text, agent, model: modelInfo, usage, toolCalls, sessionID, messageID } }
        return
      }
    }
  }
}

function createSessionHandle(sdk: OpencodeClient, sessionID: string, opts: AgentOptions): SessionHandle {
  return {
    get id() { return sessionID },

    async run(message: string, options?: RunOptions): Promise<RunResult> {
      const model = options?.model ?? (opts.model && opts.provider ? { providerID: opts.provider, modelID: opts.model } : undefined)
      const resultPromise = collectResult(sdk, sessionID, opts.hooks)
      await sdk.session.prompt({
        sessionID,
        agent: options?.agent ?? opts.agent,
        model,
        variant: options?.variant ?? opts.variant,
        parts: [{ type: "text", text: message }],
      })
      if (options?.timeout) {
        return Promise.race([
          resultPromise,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${options.timeout}ms`)), options.timeout)),
        ])
      }
      return resultPromise
    },

    stream(message: string, options?: RunOptions): AsyncIterable<StreamEvent> {
      const model = options?.model ?? (opts.model && opts.provider ? { providerID: opts.provider, modelID: opts.model } : undefined)
      const generator = streamEvents(sdk, sessionID, opts.hooks)
      sdk.session.prompt({
        sessionID,
        agent: options?.agent ?? opts.agent,
        model,
        variant: options?.variant ?? opts.variant,
        parts: [{ type: "text", text: message }],
      })
      return generator
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

/**
 * Create an agent that runs in-process without an HTTP server.
 */
export async function createAgent(options: AgentOptions): Promise<Agent> {
  await ensureLog()

  let sdk: OpencodeClient
  let disposed = false

  const ready = new Promise<void>((resolve) => {
    bootstrap(options.directory, async () => {
      sdk = createInProcessClient(options.directory)
      resolve()
      // Keep alive until dispose()
      await new Promise<void>((r) => {
        const check = () => { if (disposed) return r(); setTimeout(check, 100) }
        check()
      })
    })
  })

  await ready

  return {
    async run(message: string, runOptions?: RunOptions): Promise<RunResult> {
      if (disposed) throw new Error("Agent has been disposed")
      const session = await sdk.session.create()
      const sessionID = (session.data as any)?.id
      if (!sessionID) throw new Error("Failed to create session")
      return createSessionHandle(sdk, sessionID, options).run(message, runOptions)
    },

    stream(message: string, runOptions?: RunOptions): AsyncIterable<StreamEvent> {
      if (disposed) throw new Error("Agent has been disposed")
      return {
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
    },

    async session(): Promise<SessionHandle> {
      if (disposed) throw new Error("Agent has been disposed")
      const session = await sdk.session.create()
      const sessionID = (session.data as any)?.id
      if (!sessionID) throw new Error("Failed to create session")
      return createSessionHandle(sdk, sessionID, options)
    },

    async tool(name: string, input: Record<string, unknown>): Promise<unknown> {
      if (disposed) throw new Error("Agent has been disposed")
      const tools = await sdk.tool.ids()
      if (!(tools.data as string[])?.includes(name)) {
        throw new Error(`Tool "${name}" not found. Available: ${(tools.data as string[])?.join(", ")}`)
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

    async dispose() {
      disposed = true
    },
  }
}
