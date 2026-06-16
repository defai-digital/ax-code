/**
 * Tool resolution and schema caching for the prompt loop.
 *
 * Extracted from prompt.ts to reduce file size and improve maintainability.
 */

import z from "zod"
import { type Tool as AITool, tool, jsonSchema, type ToolCallOptions, asSchema } from "ai"
import { Log } from "../util/log"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { ModelID } from "../provider/schema"
import { Plugin } from "../plugin"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { PartID } from "./schema"
import { ToolRegistry } from "../tool/registry"
import { Tool } from "../tool/tool"
import { MCP } from "../mcp"
import { McpPermissionPattern } from "../mcp/permission-pattern"
import { ProviderTransform } from "../provider/transform"
import { Permission } from "@/permission"
import { Isolation } from "@/isolation"
import { Config } from "@/config/config"
import { Instance } from "../project/instance"
import { Truncate } from "@/tool/truncate"
import type { SessionProcessor } from "./processor"
import { permissionRulesetFromLegacyTools } from "./prompt-permission"
import { estimateToolDefinitionTokens } from "./prompt-request"

const log = Log.create({ service: "session.prompt.tools" })

// Cache transformed schemas across steps — key: "toolId:npm:provider"
let _schemaCache: Map<string, any> | undefined
const mcpSchemaPending = new Map<string, Promise<any>>()
const SCHEMA_CACHE_MAX = 500
const SCHEMA_CACHE_DROP = 100

function schemaCache() {
  if (!_schemaCache) _schemaCache = new Map()
  return _schemaCache
}

function touchSchemaCache(cacheKey: string, value: any) {
  const cache = schemaCache()
  cache.delete(cacheKey)
  cache.set(cacheKey, value)
}

function setSchemaCache(cacheKey: string, value: any) {
  const cache = schemaCache()
  if (!cache.has(cacheKey) && cache.size >= SCHEMA_CACHE_MAX) {
    let dropped = 0
    for (const key of cache.keys()) {
      cache.delete(key)
      if (++dropped >= SCHEMA_CACHE_DROP) break
    }
  }
  cache.set(cacheKey, value)
}

export async function transformMcpInputSchema(input: {
  cacheKey: string
  model: Provider.Model
  inputSchema: Parameters<typeof asSchema>[0]
}) {
  const cached = schemaCache().get(input.cacheKey)
  if (cached !== undefined) {
    touchSchemaCache(input.cacheKey, cached)
    return cached
  }

  const pending = mcpSchemaPending.get(input.cacheKey)
  if (pending) return pending

  const promise = (async () => {
    const schemaJson = await Promise.resolve(asSchema(input.inputSchema).jsonSchema)
    const cachedAfterAwait = schemaCache().get(input.cacheKey)
    if (cachedAfterAwait !== undefined) {
      touchSchemaCache(input.cacheKey, cachedAfterAwait)
      return cachedAfterAwait
    }
    const transformed = ProviderTransform.schema(input.model, schemaJson)
    setSchemaCache(input.cacheKey, transformed)
    return transformed
  })()
  mcpSchemaPending.set(input.cacheKey, promise)
  try {
    return await promise
  } finally {
    if (mcpSchemaPending.get(input.cacheKey) === promise) mcpSchemaPending.delete(input.cacheKey)
  }
}

/**
 * Compute the isolation state with path and network bypasses applied.
 * Used when retrying tool execution after isolation escalation.
 */
export function isolationRetryState(input: {
  isolation: Isolation.State | undefined
  pathBypass: string[]
  networkBypass: boolean
}): Isolation.State | undefined {
  if (!input.isolation) return undefined
  const bypass = Array.from(new Set([...(input.isolation.bypass ?? []), ...input.pathBypass]))
  return {
    ...input.isolation,
    network: input.networkBypass ? true : input.isolation.network,
    ...(bypass.length ? { bypass } : {}),
  }
}

interface ResolveToolsInput {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  tools?: Record<string, boolean>
  processor: SessionProcessor.Info
  bypassAgentCheck: boolean
  messages: MessageV2.WithParts[]
  isolation?: Isolation.State
}

export function shouldBypassAgentCheck(parts: MessageV2.Part[] | undefined): boolean {
  return parts?.some((part) => part.type === "agent") ?? false
}

type McpToolContentItem = {
  type: string
  text?: string
  mimeType?: string
  data?: string
  resource?: {
    text?: string
    blob?: string
    mimeType?: string
    uri?: string
  }
}

export function collectMcpToolContent(content: McpToolContentItem[]) {
  const textParts: string[] = []
  const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []

  for (const contentItem of content) {
    if (contentItem.type === "text" && contentItem.text) {
      textParts.push(contentItem.text)
      continue
    }
    if (contentItem.type === "image" && contentItem.data) {
      const mimeType = contentItem.mimeType ?? "image/png"
      textParts.push(`[Image content: ${mimeType}]`)
      attachments.push({
        type: "file",
        mime: mimeType,
        url: `data:${mimeType};base64,${contentItem.data}`,
      })
      continue
    }
    if (contentItem.type === "resource" && contentItem.resource) {
      const { resource } = contentItem
      if (resource.text) textParts.push(resource.text)
      if (resource.blob) {
        const mimeType = resource.mimeType ?? "application/octet-stream"
        textParts.push(`[Binary MCP resource: ${resource.uri ?? "unknown"} (${mimeType})]`)
        attachments.push({
          type: "file",
          mime: mimeType,
          url: `data:${mimeType};base64,${resource.blob}`,
          filename: resource.uri,
        })
      }
    }
  }

  return { textParts, attachments }
}

export async function estimateRegistryToolSchemaTokens(input: {
  agent: Agent.Info
  model: Provider.Model
  tools?: Record<string, boolean>
  sessionPermission?: Permission.Ruleset
}) {
  const ruleset = Permission.merge(
    input.agent.permission,
    input.sessionPermission ?? [],
    permissionRulesetFromLegacyTools(input.tools),
  )
  const registryTools = await ToolRegistry.tools(
    { modelID: ModelID.make(input.model.api.id), providerID: input.model.providerID },
    input.agent,
  )
  const disabledRegistryTools = Permission.disabled(
    registryTools.map((item) => item.id),
    ruleset,
  )
  return estimateToolDefinitionTokens(
    registryTools
      .filter((item) => input.tools?.[item.id] !== false && !disabledRegistryTools.has(item.id))
      .map((item) => ({
        id: item.id,
        description: item.description,
        inputSchema: ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters)),
      })),
  )
}

/**
 * Resolve and configure all available tools for a session turn.
 * Handles schema transformation, caching, isolation escalation, and MCP tools.
 */
export async function resolveTools(input: ResolveToolsInput) {
  using _ = log.time("resolveTools")
  const tools: Record<string, AITool> = {}
  const isolation =
    input.isolation ?? Isolation.resolve((await Config.get()).isolation, Instance.directory, Instance.worktree)
  const ruleset = Permission.merge(
    input.agent.permission,
    input.session.permission ?? [],
    permissionRulesetFromLegacyTools(input.tools),
  )
  // Share transformed schemas across tool resolution calls.
  const cache = schemaCache()
  const schemaCacheKey = (toolId: string) => `${toolId}:${input.model.api.npm}:${input.model.providerID}`
  const isDisabledByConfig = (toolID: string) => input.tools?.[toolID] === false

  const context = (args: any, options: ToolCallOptions, isolationOverride?: Isolation.State): Tool.Context => ({
    sessionID: input.session.id,
    // The AI SDK normally passes an AbortSignal, but `abortSignal` is
    // typed as optional. Fall back to a fresh never-firing controller
    // signal so tools that read `context.abort.aborted` /
    // `addEventListener("abort", ...)` don't crash with
    // "cannot read properties of undefined" if the SDK ever omits it.
    abort: options.abortSignal ?? new AbortController().signal,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: {
      model: input.model,
      bypassAgentCheck: input.bypassAgentCheck,
      isolation: isolationOverride ?? isolation,
    },
    agent: input.agent.name,
    messages: input.messages,
    metadata: async (val: { title?: string; metadata?: any }) => {
      const match = input.processor.partFromToolCall(options.toolCallId)
      if (match && match.state.status === "running") {
        await Session.updatePart({
          ...match,
          state: {
            title: val.title,
            metadata: val.metadata,
            status: "running",
            input: args,
            time: {
              start: match.state.time?.start ?? Date.now(),
            },
          },
        })
      }
    },
    async ask(req) {
      await Permission.ask(
        {
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset,
          agent: input.agent.name,
        },
        { signal: options.abortSignal ?? undefined },
      )
    },
  })

  const registryTools = await ToolRegistry.tools(
    { modelID: ModelID.make(input.model.api.id), providerID: input.model.providerID },
    input.agent,
  )
  const disabledRegistryTools = Permission.disabled(
    registryTools.map((item) => item.id),
    ruleset,
  )
  for (const item of registryTools) {
    if (isDisabledByConfig(item.id) || disabledRegistryTools.has(item.id)) continue

    const cacheKey = schemaCacheKey(item.id)
    const cached = cache.get(cacheKey)
    const schema =
      cached !== undefined
        ? // LRU: move to end so recently-used entries survive eviction
          (touchSchemaCache(cacheKey, cached), cached)
        : (() => {
            const s = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
            // Bound the cache to avoid a slow memory leak in long-running
            // processes (TUI/daemon) that accumulate tool×model entries
            // across session lifetimes. LRU eviction: when we reach the
            // cap, drop the 100 least-recently-used entries. Maps preserve
            // insertion order, so `.keys()` iterates oldest first.
            setSchemaCache(cacheKey, s)
            return s
          })()
    tools[item.id] = tool({
      id: item.id as any,
      description: item.description,
      inputSchema: jsonSchema(schema as any),
      async execute(args, options) {
        const ctx = context(args, options)
        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: item.id,
            sessionID: ctx.sessionID,
            callID: ctx.callID,
          },
          {
            args,
          },
        )
        let result: Awaited<ReturnType<typeof item.execute>> | undefined
        // Per-path bypass: when the user approves an isolation_escalation
        // for one path inside a multi-path tool call (e.g. apply_patch
        // with several hunks), we must NOT exempt every other path in
        // the same call. Accumulate approved paths and re-run the tool;
        // if a later path also fails, ask again. Cap retries to bounding
        // the loop in the rare case the tool is non-deterministic about
        // which path it touches first.
        //
        // Network denials have no path, so retry by enabling only network
        // access while preserving the active write/protected-path policy.
        const bypass: string[] = []
        let networkBypass = false
        let lastError: Isolation.DeniedError | undefined
        for (let attempt = 0; attempt < 16; attempt++) {
          let attemptCtx = ctx
          if (attempt > 0 && ctx.extra?.isolation) {
            attemptCtx = context(
              args,
              options,
              isolationRetryState({
                isolation: ctx.extra.isolation,
                pathBypass: bypass,
                networkBypass,
              }),
            )
          }
          try {
            result = await item.execute(args, attemptCtx)
            break
          } catch (e) {
            if (!(e instanceof Isolation.DeniedError)) throw e
            if (ctx.extra?.isolation?.mode === "read-only")
              throw new Error(`Tool denied in read-only mode: ${e.reason}`, { cause: e })
            if (!e.path) {
              if (e.reason !== "network") throw e
              if (networkBypass) {
                lastError = e
                throw e
              }
              await ctx.ask({
                permission: "isolation_escalation",
                patterns: [e.message],
                always: [],
                metadata: { reason: e.reason, requireInteractive: true },
              })
              networkBypass = true
              lastError = e
              continue
            }
            if (bypass.includes(e.path)) {
              lastError = e
              throw e
            }
            await ctx.ask({
              permission: "isolation_escalation",
              patterns: [e.message],
              always: [],
              metadata: { reason: e.reason, path: e.path, requireInteractive: true },
            })
            bypass.push(e.path)
            lastError = e
          }
        }
        if (result === undefined) throw lastError ?? new Error("Tool execution exhausted isolation retries")
        const output = {
          ...result,
          attachments: result.attachments?.map((attachment) => ({
            ...attachment,
            id: PartID.ascending(),
            sessionID: ctx.sessionID,
            messageID: input.processor.message.id,
          })),
        }
        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: item.id,
            sessionID: ctx.sessionID,
            callID: ctx.callID,
            args,
          },
          output,
        )
        return output
      },
    })
  }

  const mcpTools = await MCP.tools()
  const disabledMcpTools = Permission.disabled(Object.keys(mcpTools), ruleset)
  for (const [key, item] of Object.entries(mcpTools)) {
    if (isDisabledByConfig(key) || disabledMcpTools.has(key)) continue

    const execute = item.execute
    if (!execute) continue

    // `MCP.tools()` returns references to cached tool objects; mutating
    // `item.inputSchema` directly would re-transform the schema on every
    // loop iteration, double-wrapping the JSON schema and eventually
    // producing malformed input for the LLM. Clone to a fresh object so
    // the transformation is idempotent across iterations.
    const mcpTool = { ...item }
    const mcpCacheKey = schemaCacheKey(`mcp:${key}`)
    const transformed = await transformMcpInputSchema({
      cacheKey: mcpCacheKey,
      model: input.model,
      inputSchema: mcpTool.inputSchema,
    })
    mcpTool.inputSchema = jsonSchema(transformed)
    // Wrap execute to add plugin hooks and format output
    mcpTool.execute = async (args, opts) => {
      const ctx = context(args, opts)

      await Plugin.trigger(
        "tool.execute.before",
        {
          tool: key,
          sessionID: ctx.sessionID,
          callID: opts.toolCallId,
        },
        {
          args,
        },
      )

      const permissionPattern = McpPermissionPattern.derive(key, args, { worktree: Instance.worktree })
      await ctx.ask({
        permission: key,
        metadata: {
          mcp: true,
          ...permissionPattern.metadata,
        },
        patterns: permissionPattern.patterns,
        always: permissionPattern.always,
      })

      const result = await execute(args, opts)

      await Plugin.trigger(
        "tool.execute.after",
        {
          tool: key,
          sessionID: ctx.sessionID,
          callID: opts.toolCallId,
          args,
        },
        result,
      )

      const { textParts, attachments } = collectMcpToolContent(result.content as McpToolContentItem[])

      const outputText = textParts.length ? `[Untrusted MCP tool content from ${key}]\n\n${textParts.join("\n\n")}` : ""
      const truncated = await Truncate.output(outputText, {}, input.agent)
      const metadata = {
        ...(result.metadata ?? {}),
        truncated: truncated.truncated,
        ...(truncated.truncated && {
          outputPath: truncated.outputPath,
          fullOutputPath: truncated.fullOutputPath,
          originalSize: truncated.originalSize,
          truncatedTo: truncated.truncatedTo,
          contentHint: truncated.contentHint,
        }),
      }

      return {
        title: "",
        metadata,
        output: truncated.content,
        attachments: attachments.map((attachment) => ({
          ...attachment,
          id: PartID.ascending(),
          sessionID: ctx.sessionID,
          messageID: input.processor.message.id,
        })),
        content: [{ type: "text", text: truncated.content }] as any,
      }
    }
    tools[key] = mcpTool
  }

  return tools
}
