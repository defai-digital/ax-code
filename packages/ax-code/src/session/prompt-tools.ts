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
import { uniqueStrings } from "@/util/string-list"
import type { SessionProcessor } from "./processor"
import { permissionRulesetFromLegacyTools } from "./prompt-permission"
import { estimateToolDefinitionTokens } from "./prompt-request"
import { createHash } from "node:crypto"

const log = Log.create({ service: "session.prompt.tools" })

// Schema transforms may capture project-defined tool schemas. Keep both the
// LRU and in-flight work scoped to the active project instance so two projects
// with the same tool ID/model cannot reuse each other's schema.
const schemaState = Instance.state(() => ({
  cache: new Map<string, any>(),
  mcpPending: new Map<string, Promise<any>>(),
}))
const SCHEMA_CACHE_MAX = 500
const SCHEMA_CACHE_DROP = 100

function schemaCache() {
  return schemaState().cache
}

function touchSchemaCache(cache: Map<string, any>, cacheKey: string, value: any) {
  cache.delete(cacheKey)
  cache.set(cacheKey, value)
}

function setSchemaCache(cache: Map<string, any>, cacheKey: string, value: any) {
  if (!cache.has(cacheKey) && cache.size >= SCHEMA_CACHE_MAX) {
    let dropped = 0
    for (const key of cache.keys()) {
      cache.delete(key)
      if (++dropped >= SCHEMA_CACHE_DROP) break
    }
  }
  cache.set(cacheKey, value)
}

function schemaFingerprint(schema: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(schema) ?? "undefined")
    .digest("base64url")
}

export async function transformMcpInputSchema(input: {
  cacheKey: string
  model: Provider.Model
  inputSchema: Parameters<typeof asSchema>[0]
}) {
  const current = schemaState()
  const schemaJson = await Promise.resolve(asSchema(input.inputSchema).jsonSchema)
  const modelIdentity = schemaFingerprint({
    id: input.model.id,
    providerID: input.model.providerID,
    apiID: input.model.api.id,
    npm: input.model.api.npm,
    url: input.model.api.url,
  })
  const cacheKey = `${input.cacheKey}:${modelIdentity}:${schemaFingerprint(schemaJson)}`
  const cached = current.cache.get(cacheKey)
  if (cached !== undefined) {
    touchSchemaCache(current.cache, cacheKey, cached)
    return cached
  }

  const pending = current.mcpPending.get(cacheKey)
  if (pending) return pending

  const promise = (async () => {
    const cachedAfterAwait = current.cache.get(cacheKey)
    if (cachedAfterAwait !== undefined) {
      touchSchemaCache(current.cache, cacheKey, cachedAfterAwait)
      return cachedAfterAwait
    }
    const transformed = ProviderTransform.schema(input.model, schemaJson)
    setSchemaCache(current.cache, cacheKey, transformed)
    return transformed
  })()
  current.mcpPending.set(cacheKey, promise)
  try {
    return await promise
  } finally {
    if (current.mcpPending.get(cacheKey) === promise) current.mcpPending.delete(cacheKey)
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
  const bypass = uniqueStrings([...(input.isolation.bypass ?? []), ...input.pathBypass])
  return {
    ...input.isolation,
    network: input.networkBypass ? true : input.isolation.network,
    ...(bypass.length ? { bypass } : {}),
  }
}

/**
 * Shared evidence boundary for every supported tool surface. The execution
 * closure remains surface-specific (registry isolation, MCP permission, etc.)
 * while plugin and user lifecycle hooks stay consistent.
 */
export async function runToolLifecycle<T>(input: {
  toolID: string
  sessionID: string
  callID?: string
  args: unknown
  cwd: string
  execute(): Promise<T>
}): Promise<T> {
  await Plugin.trigger(
    "tool.execute.before",
    {
      tool: input.toolID,
      sessionID: input.sessionID,
      callID: input.callID,
    },
    { args: input.args },
  )

  try {
    const { LifecycleHooks } = await import("@/hooks/lifecycle")
    const pre = await LifecycleHooks.runForWorkspace({
      event: "PreToolUse",
      sessionID: input.sessionID,
      tool: input.toolID,
      args: input.args,
      cwd: input.cwd,
    })
    if (pre.blocked) {
      const detail =
        pre.blockReason ??
        pre.outputs
          .filter((output) => output.exit !== 0)
          .map((output) => output.stderr || output.stdout || `exit ${output.exit}`)
          .join("\n")
      throw new Error(`PreToolUse hook blocked tool ${input.toolID}: ${detail || "hook failed"}`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PreToolUse hook blocked")) throw error
    // Hook load/run failures must not brick the agent loop.
  }

  const result = await input.execute()

  await Plugin.trigger(
    "tool.execute.after",
    {
      tool: input.toolID,
      sessionID: input.sessionID,
      callID: input.callID,
      args: input.args,
    },
    result,
  )

  try {
    const { LifecycleHooks } = await import("@/hooks/lifecycle")
    await LifecycleHooks.runForWorkspace({
      event: "PostToolUse",
      sessionID: input.sessionID,
      tool: input.toolID,
      args: input.args,
      cwd: input.cwd,
    })
  } catch {
    // Post hooks are evidence/automation helpers and remain non-fatal.
  }

  return result
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
  /**
   * When true, the upcoming provider request will not send tool schemas
   * (forced text-only / response-only synthesis). An empty `tools: {}` map is
   * NOT enough — that means "no per-tool overrides" and still enables the full
   * registry for estimation.
   */
  omitToolSchemas?: boolean
}) {
  if (input.omitToolSchemas) return 0
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
  const modelSchemaIdentity = schemaFingerprint({
    id: input.model.id,
    providerID: input.model.providerID,
    apiID: input.model.api.id,
    npm: input.model.api.npm,
    url: input.model.api.url,
  })
  const schemaCacheKey = (toolId: string) => `${toolId}:${modelSchemaIdentity}`
  const isDisabledByConfig = (toolID: string) => input.tools?.[toolID] === false
  let registryDispatcher: Tool.Dispatcher | undefined

  type InvocationOptions = Pick<ToolCallOptions, "toolCallId" | "abortSignal">
  const context = (
    args: any,
    options: InvocationOptions,
    isolationOverride?: Isolation.State,
    exposeDispatcher = false,
  ): Tool.Context => ({
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
      ...(exposeDispatcher ? { toolDispatcher: registryDispatcher } : {}),
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
  const isolationDisabled = new Set<string>()
  if (isolation.mode === "read-only") {
    for (const id of ["edit", "write", "apply_patch", "multiedit", "bash"]) isolationDisabled.add(id)
  }
  if (!isolation.network) {
    for (const id of ["webfetch", "websearch", "codesearch"]) isolationDisabled.add(id)
  }
  const enabledRegistryTools = registryTools.filter(
    (item) => !isDisabledByConfig(item.id) && !disabledRegistryTools.has(item.id) && !isolationDisabled.has(item.id),
  )
  const batchableRegistryTools = new Map(
    enabledRegistryTools.filter((item) => item.id !== "batch" && item.id !== "task").map((item) => [item.id, item]),
  )

  async function invokeRegistryTool(inputTool: {
    item: (typeof registryTools)[number]
    args: any
    options: InvocationOptions
    isolationPolicy: "escalate" | "fail-closed"
  }): Promise<Tool.InvocationResult> {
    const { item, args, options, isolationPolicy } = inputTool
    const exposeDispatcher = item.id === "batch" && isolationPolicy === "escalate"
    const ctx = context(args, options, undefined, exposeDispatcher)

    return runToolLifecycle({
      toolID: item.id,
      sessionID: ctx.sessionID,
      callID: ctx.callID,
      args,
      cwd: Instance.directory,
      execute: async () => {
        let result: Awaited<ReturnType<typeof item.execute>> | undefined
        if (isolationPolicy === "fail-closed") {
          // Batch calls run concurrently. Never open interactive escalation
          // prompts from nested workers; an isolation denial is the result.
          result = await item.execute(args, ctx)
        } else {
          // Per-path bypass: when the user approves an isolation_escalation
          // for one path inside a multi-path tool call (e.g. apply_patch with
          // several hunks), exempt only that path and retry. Network denials
          // similarly enable only network access. Bound retries in case a tool
          // is non-deterministic about the first denied operation it touches.
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
                exposeDispatcher,
              )
            }
            try {
              result = await item.execute(args, attemptCtx)
              break
            } catch (error) {
              if (!(error instanceof Isolation.DeniedError)) throw error
              if (ctx.extra?.isolation?.mode === "read-only") {
                throw new Error(`Tool denied in read-only mode: ${error.reason}`, { cause: error })
              }
              if (!error.path) {
                if (error.reason !== "network") throw error
                if (networkBypass) {
                  lastError = error
                  throw error
                }
                await ctx.ask({
                  permission: "isolation_escalation",
                  patterns: [error.message],
                  always: [],
                  metadata: { reason: error.reason, requireInteractive: true },
                })
                networkBypass = true
                lastError = error
                continue
              }
              if (bypass.includes(error.path)) {
                lastError = error
                throw error
              }
              await ctx.ask({
                permission: "isolation_escalation",
                patterns: [error.message],
                always: [],
                metadata: { reason: error.reason, path: error.path, requireInteractive: true },
              })
              bypass.push(error.path)
              lastError = error
            }
          }
          if (result === undefined) throw lastError ?? new Error("Tool execution exhausted isolation retries")
        }

        return {
          ...result,
          attachments: result.attachments?.map((attachment) => ({
            ...attachment,
            id: PartID.ascending(),
            sessionID: ctx.sessionID,
            messageID: input.processor.message.id,
          })),
        }
      },
    })
  }

  registryDispatcher = {
    ids: [...batchableRegistryTools.keys()],
    concurrencySafe(dispatch) {
      const item = batchableRegistryTools.get(dispatch.tool)
      if (!item?.concurrencySafe) return false
      try {
        return item.concurrencySafe(dispatch.parameters) === true
      } catch {
        // Fail closed: a throwing classifier means the call is a barrier.
        return false
      }
    },
    async execute(dispatch) {
      const item = batchableRegistryTools.get(dispatch.tool)
      if (!item) throw new Error(`Tool '${dispatch.tool}' is not enabled for Batch execution`)
      let args: unknown
      try {
        args = item.parameters.parse(dispatch.parameters)
      } catch (error) {
        if (error instanceof z.ZodError && item.formatValidationError) {
          throw new Error(item.formatValidationError(error), { cause: error })
        }
        throw error
      }
      return invokeRegistryTool({
        item,
        args,
        options: { toolCallId: dispatch.callID, abortSignal: dispatch.abort },
        isolationPolicy: "fail-closed",
      })
    },
  }

  for (const item of enabledRegistryTools) {
    const schemaJson = z.toJSONSchema(item.parameters)
    const cacheKey = schemaCacheKey(`${item.id}:${schemaFingerprint(schemaJson)}`)
    const cached = cache.get(cacheKey)
    const schema =
      cached !== undefined
        ? // LRU: move to end so recently-used entries survive eviction
          (touchSchemaCache(cache, cacheKey, cached), cached)
        : (() => {
            const s = ProviderTransform.schema(input.model, schemaJson)
            // Bound the cache to avoid a slow memory leak in long-running
            // processes (TUI/daemon) that accumulate tool×model entries
            // across session lifetimes. LRU eviction: when we reach the
            // cap, drop the 100 least-recently-used entries. Maps preserve
            // insertion order, so `.keys()` iterates oldest first.
            setSchemaCache(cache, cacheKey, s)
            return s
          })()
    tools[item.id] = tool({
      id: item.id as any,
      description: item.description,
      inputSchema: jsonSchema(schema as any),
      async execute(args, options) {
        return invokeRegistryTool({ item, args, options, isolationPolicy: "escalate" })
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
      const result = await runToolLifecycle({
        toolID: key,
        sessionID: ctx.sessionID,
        callID: opts.toolCallId,
        args,
        cwd: Instance.directory,
        execute: async () => {
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
          return execute(args, opts)
        },
      })

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
