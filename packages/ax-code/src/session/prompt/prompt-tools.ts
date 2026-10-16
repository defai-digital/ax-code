/**
 * Tool resolution and schema caching for the prompt loop.
 *
 * Extracted from prompt.ts to reduce file size and improve maintainability.
 */

import z from "zod"
import { type Tool as AITool, tool, jsonSchema, type ToolCallOptions, asSchema } from "ai"
import { Log } from "../../util/log"
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import { ModelID } from "../../provider/schema"
import { Plugin } from "../../plugin"
import { Session } from ".."
import { MessageV2 } from "../message-v2"
import { PartID } from "../schema"
import { ToolRegistry } from "../../tool/registry"
import { Tool } from "../../tool/tool"
import { MCP } from "../../mcp"
import { ToolDiscovery } from "../tool-discovery"
import { McpPermissionPattern } from "../../mcp/permission-pattern"
import { McpElicitation } from "../../mcp/elicitation"
import { WebMcpApprovals } from "../../mcp/webmcp-approvals"
import { WebMcpAutoApproval } from "../../mcp/webmcp-auto-approval"
import { WebMcpProfile } from "../../mcp/webmcp-profile"
import { BrowserWorkflow } from "../../browser-workflow/service"
import { BrowserSelection } from "../../browser-workflow/selection"
import { isKnownCliProviderID } from "../../provider/cli/ids"
import { ProviderTransform } from "../../provider/transform"
import { Permission } from "@/permission"
import { Isolation } from "@/isolation"
import { Config } from "@/config/config"
import { Instance } from "../../project/instance"
import { Truncate } from "@/tool/truncate"
import { truncateUtf8Bytes } from "@/tool/bash-helpers"
import { uniqueStrings } from "@/util/string-list"
import { isRecord } from "@/util/record"
import { defer } from "@/util/defer"
import { wrapUntrustedContent } from "../../util/untrusted-content"
import { ToolWriteGate } from "../tool-write-gate"
import type { SessionProcessor } from "../processor"
import {
  MAX_MCP_HOOK_FEEDBACK_BYTES,
  boundMcpResultText,
  collectMcpToolResult,
  mcpResultPartMetadata,
} from "./prompt-mcp-content"
import { permissionRulesetFromLegacyTools } from "./prompt-permission"
import { estimateToolDefinitionTokens } from "./prompt-request"
import { createHash } from "node:crypto"

const log = Log.create({ service: "session.prompt.tools" })

/**
 * ADR-174 rule 11: each live assistant-turn processor owns its T2 breaker.
 * Weak keys release completed turns and prevent late calls from replacing
 * another turn's counters.
 */
const webmcpBreakers = Instance.state(() => new WeakMap<SessionProcessor.Info, WebMcpProfile.InteractBreaker>())

function webmcpTurnBreaker(processor: SessionProcessor.Info): WebMcpProfile.InteractBreaker {
  const map = webmcpBreakers()
  const existing = map.get(processor)
  if (existing) return existing
  const fresh = new WebMcpProfile.InteractBreaker(processor.message.id)
  map.set(processor, fresh) // @scan-suppress lifecycle_scan: weak processor keys are collected after the turn
  return fresh
}

function webmcpTargetSummary(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined
  const parts: string[] = []
  if (typeof metadata.tool === "string") parts.push(metadata.tool)
  const target = isRecord(metadata.target) ? metadata.target : undefined
  if (target && typeof target.uid === "string" && target.uid) parts.push(`uid ${target.uid}`)
  if (target && typeof target.name === "string" && target.name) parts.push(`"${target.name.slice(0, 60)}"`)
  if (typeof metadata.pageOrigin === "string") parts.push(`on ${metadata.pageOrigin}`)
  return parts.length > 0 ? parts.join(" ") : undefined
}

// Schema transforms may capture project-defined tool schemas. Keep both the
// LRU and in-flight work scoped to the active project instance so two projects
// with the same tool ID/model cannot reuse each other's schema.
type PendingSchema = { promise: Promise<any> }
const schemaState = Instance.state(() => ({
  cache: new Map<string, any>(),
  mcpPending: new Map<string, PendingSchema>(),
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
  if (pending) return pending.promise

  const inFlight: PendingSchema = {
    promise: (async () => {
      const cachedAfterAwait = current.cache.get(cacheKey)
      if (cachedAfterAwait !== undefined) {
        touchSchemaCache(current.cache, cacheKey, cachedAfterAwait)
        return cachedAfterAwait
      }
      const transformed = ProviderTransform.schema(input.model, schemaJson)
      setSchemaCache(current.cache, cacheKey, transformed)
      return transformed
    })(),
  }
  current.mcpPending.set(cacheKey, inFlight)
  try {
    return await inFlight.promise
  } finally {
    if (current.mcpPending.get(cacheKey) === inFlight) current.mcpPending.delete(cacheKey)
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
/** Permission name used when a PreToolUse hook answers `ask`. Interactive-only. */
export const HOOK_CONFIRMATION_PERMISSION = "hook"

/**
 * Tools that mutate the workspace, run code, or reach outside the process
 * and therefore take the exclusive lane of the session write gate when the
 * model calls them in parallel with other tools. Everything else is shared.
 * MCP tools are exclusive: their side effects are unknown to the harness.
 */
const EXCLUSIVE_TOOL_IDS: ReadonlySet<string> = new Set([
  "edit",
  "write",
  "multiedit",
  "apply_patch",
  "notebook_edit",
  "refactor_apply",
  "bash",
  "bash_input",
  "ops_apply",
  "task",
  "task_parallel",
])

export function toolGateMode(input: {
  toolID: string
  args: unknown
  childSafe?: (call: { tool: string; parameters: unknown }) => boolean
}): "shared" | "exclusive" {
  if (EXCLUSIVE_TOOL_IDS.has(input.toolID)) return "exclusive"
  if (input.toolID === "batch") {
    // A batch is only as safe as its least safe child.
    const calls = isRecord(input.args) && Array.isArray(input.args["tool_calls"]) ? input.args["tool_calls"] : []
    for (const call of calls) {
      if (!isRecord(call) || typeof call["tool"] !== "string") return "exclusive"
      if (!input.childSafe?.({ tool: call["tool"], parameters: call["parameters"] })) return "exclusive"
    }
  }
  return "shared"
}

/** Wrap PostToolUse hook feedback so the model can tell it apart from tool output. */
export function formatHookFeedback(feedback: string) {
  return `\n\n<hook_feedback event="PostToolUse">\n${feedback}\n</hook_feedback>`
}

/**
 * Hook feedback for the MCP result path, under its own budget. Feedback is
 * appended AFTER the tool-output cap, so neither side can squeeze the other
 * out: untrusted output keeps its 8 MiB and trusted plugin signals always
 * keep up to 64 KiB. The feedback body truncates before formatting, so the
 * format wrapper never copies an unbounded plugin string.
 */
export function boundMcpHookFeedback(feedback: string): string {
  const overhead = Buffer.byteLength(formatHookFeedback(""), "utf8")
  const marker = `[hook feedback truncated at ${MAX_MCP_HOOK_FEEDBACK_BYTES} bytes]`
  if (Buffer.byteLength(feedback, "utf8") + overhead <= MAX_MCP_HOOK_FEEDBACK_BYTES) return formatHookFeedback(feedback)
  return formatHookFeedback(
    `${truncateUtf8Bytes(feedback, MAX_MCP_HOOK_FEEDBACK_BYTES - overhead - Buffer.byteLength(marker, "utf8") - 1)}\n${marker}`,
  )
}

export async function runToolLifecycle<T>(input: {
  toolID: string
  sessionID: string
  callID?: string
  args: unknown
  cwd: string
  /**
   * Permission channel of the calling tool. When present, a PreToolUse hook
   * that answers `ask` is routed here as an interactive-only `hook`
   * permission; when absent the ask degrades to a fail-safe block.
   */
  ask?: Tool.Context["ask"]
  /** Receives bounded PostToolUse hook feedback for inclusion in the tool result. */
  onFeedback?: (feedback: string) => void
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

  let askReason: string | undefined
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
    if (pre.ask) {
      if (!input.ask) throw new Error(`PreToolUse hook blocked tool ${input.toolID}: ${pre.ask.reason}`)
      askReason = pre.ask.reason
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PreToolUse hook blocked")) throw error
    // Hook load/run failures must not brick the agent loop.
  }

  if (askReason !== undefined && input.ask) {
    // Outside the try above so a user rejection propagates as the ordinary
    // Permission.RejectedError the processor already understands.
    await input.ask({
      permission: HOOK_CONFIRMATION_PERMISSION,
      patterns: [input.toolID],
      always: [],
      metadata: { requireInteractive: true, tool: input.toolID, reason: askReason },
    })
  }

  let result: T
  try {
    result = await input.execute()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    void import("@/hooks/lifecycle")
      .then(({ LifecycleHooks }) =>
        LifecycleHooks.runForWorkspace({
          event: "PostToolUseFailure",
          sessionID: input.sessionID,
          tool: input.toolID,
          args: { args: input.args, error: message.slice(0, 4_000) },
          cwd: input.cwd,
        }),
      )
      .catch(() => undefined)
    throw error
  }

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
    const post = await LifecycleHooks.runForWorkspace({
      event: "PostToolUse",
      sessionID: input.sessionID,
      tool: input.toolID,
      args: input.args,
      cwd: input.cwd,
    })
    if (post.feedback && input.onFeedback) input.onFeedback(post.feedback)
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
  goalBinding?: { created: number | undefined }
}

export function shouldBypassAgentCheck(parts: MessageV2.Part[] | undefined): boolean {
  return parts?.some((part) => part.type === "agent") ?? false
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
  const definitions: Array<{ id: string; description?: string; inputSchema: unknown }> = registryTools
    .filter((item) => input.tools?.[item.id] !== false && !disabledRegistryTools.has(item.id))
    .map((item) => ({
      id: item.id,
      description: item.description,
      inputSchema: ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters)),
    }))

  // resolveTools also sends connected MCP tools and, when a WebMCP bridge is
  // among them, the browser_workflow tool. Neither comes from the registry, so
  // leaving them out under-counted a bridged session's tool schemas by roughly
  // 45 KB and let an oversized first request pass preflight. Mirror the same
  // admission rules; fail soft to the registry-only count if MCP is unavailable.
  const mcpTools = await MCP.tools().catch((error) => {
    log.warn("mcp tools unavailable for preflight estimate", { error })
    return {} as Awaited<ReturnType<typeof MCP.tools>>
  })
  const disabledMcpTools = Permission.disabled(Object.keys(mcpTools), ruleset)
  const modelIdentity = schemaFingerprint({
    id: input.model.id,
    providerID: input.model.providerID,
    apiID: input.model.api.id,
    npm: input.model.api.npm,
    url: input.model.api.url,
  })
  for (const [key, item] of Object.entries(mcpTools)) {
    if (input.tools?.[key] === false || disabledMcpTools.has(key) || !item.execute) continue
    definitions.push({
      id: key,
      description: item.description,
      inputSchema: await transformMcpInputSchema({
        cacheKey: `mcp:${key}:${modelIdentity}`,
        model: input.model,
        inputSchema: item.inputSchema,
      }),
    })
  }
  if (
    Object.values(mcpTools).some((item) => item.webmcp) &&
    input.tools?.browser_workflow !== false &&
    !Permission.disabled(["browser_workflow"], ruleset).has("browser_workflow")
  ) {
    definitions.push({
      id: "browser_workflow",
      description: BrowserWorkflow.description,
      inputSchema: ProviderTransform.schema(input.model, z.toJSONSchema(BrowserWorkflow.Parameters)),
    })
  }
  return estimateToolDefinitionTokens(definitions)
}

/**
 * Resolve and configure all available tools for a session turn.
 * Handles schema transformation, caching, isolation escalation, and MCP tools.
 */
export async function resolveTools(input: ResolveToolsInput) {
  using _ = log.time("resolveTools")
  const boundGoal = input.goalBinding ? { ...input.goalBinding } : undefined
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
    goalBinding: boundGoal,
    onGoalCreated: input.goalBinding
      ? (created) => {
          input.goalBinding!.created = created
        }
      : undefined,
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
            // Progress updates retain the processor's canonical, redacted
            // input; execution args may still contain credentials.
            input: match.state.input,
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
    enabledRegistryTools
      .filter((item) => item.id !== "batch" && item.id !== "task" && item.id !== "read_recipe")
      .map((item) => [item.id, item]),
  )

  async function invokeRegistryTool(inputTool: {
    item: (typeof registryTools)[number]
    args: any
    options: InvocationOptions
    isolationPolicy: "escalate" | "fail-closed"
  }): Promise<Tool.InvocationResult> {
    const { item, args, options, isolationPolicy } = inputTool
    const exposeDispatcher = (item.id === "batch" || item.id === "read_recipe") && isolationPolicy === "escalate"
    const ctx = context(args, options, undefined, exposeDispatcher)

    // Direct model calls in one step run concurrently in the AI SDK; the
    // write gate serializes mutating tools against everything else. Batch
    // workers (fail-closed policy) already run under Batch's own barrier and
    // inside the batch call's lane, so they must not re-enter the gate.
    const releaseLane =
      isolationPolicy === "escalate"
        ? await ToolWriteGate.acquire(
            ctx.sessionID,
            toolGateMode({
              toolID: item.id,
              args,
              childSafe: (call) => registryDispatcher?.concurrencySafe?.(call) === true,
            }),
            ctx.abort,
          )
        : undefined
    try {
      return await invokeRegistryToolLifecycle(inputTool, ctx)
    } finally {
      releaseLane?.()
    }
  }

  async function invokeRegistryToolLifecycle(
    inputTool: {
      item: (typeof registryTools)[number]
      args: any
      options: InvocationOptions
      isolationPolicy: "escalate" | "fail-closed"
    },
    ctx: Tool.Context,
  ): Promise<Tool.InvocationResult> {
    const { item, args, options, isolationPolicy } = inputTool
    const exposeDispatcher = (item.id === "batch" || item.id === "read_recipe") && isolationPolicy === "escalate"
    let hookFeedback: string | undefined
    const lifecycle = await runToolLifecycle({
      toolID: item.id,
      sessionID: ctx.sessionID,
      callID: ctx.callID,
      args,
      cwd: Instance.directory,
      // Batch workers run fail-closed: no interactive prompts from nested
      // workers, so a hook `ask` there degrades to a block like isolation.
      ask: isolationPolicy === "escalate" ? (req) => ctx.ask(req) : undefined,
      onFeedback: (feedback) => {
        hookFeedback = feedback
      },
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
    if (hookFeedback === undefined) return lifecycle
    return { ...lifecycle, output: `${lifecycle.output}${formatHookFeedback(hookFeedback)}` }
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

  // Private invocation identity: nested workflow calls retain this session's
  // permission/lifecycle wrappers while reusing the workflow's exclusive lane.
  const browserCalls = new WeakMap<object, { result?: unknown }>()
  const mcpTools = await MCP.tools()
  const discoveryCatalog: ToolDiscovery.Entry[] = []
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
    discoveryCatalog.push({ name: key, description: mcpTool.description ?? "", schema: transformed })
    // Wrap execute to add plugin hooks and format output
    mcpTool.execute = async (args, opts) => {
      const ctx = context(args, opts)
      // Bridge the session identity onto the AI SDK options object: its
      // identity flows into the converted tool's execute, where the MCP
      // client's elicitation handler resolves it to surface server-initiated
      // prompts in the session that is waiting on this call.
      McpElicitation.bindCallContext(opts, {
        sessionID: ctx.sessionID,
        signal: ctx.abort,
        tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
      })
      let hookFeedback: string | undefined
      // @scan-suppress race_scan - This invocation-local token is installed synchronously by the workflow while it holds the exclusive session lane; only that nested call can reuse the lane.
      const nestedBrowser = browserCalls.get(opts)
      const releaseLane = nestedBrowser ? () => {} : await ToolWriteGate.acquire(ctx.sessionID, "exclusive", ctx.abort)
      using _lane = defer(releaseLane)
      const result = await runToolLifecycle({
        toolID: key,
        sessionID: ctx.sessionID,
        callID: opts.toolCallId,
        args,
        cwd: Instance.directory,
        ask: (req) => ctx.ask(req),
        onFeedback: (feedback) => {
          hookFeedback = feedback
        },
        execute: async () => {
          const policy = item.webmcp
          // ADR-168: a navigation to a well-formed but unallowlisted origin is
          // caught here (call time) or after dispatch (a redirect target the
          // bridge blocked). Both paths offer the same session-only grant; the
          // tool objects of this step hold the pre-relaunch client, so the
          // model retries on the next step.
          const grantOrigin = async (grantPolicy: WebMcpProfile.Policy, error: unknown): Promise<never> => {
            if (!(error instanceof WebMcpProfile.OriginNotGrantedError)) throw error
            // A managed or schema refusal fails here without a prompt.
            const allowed = await MCP.checkWebMcpOriginGrant(grantPolicy.server, error.origin)
            if (!allowed.ok) throw new Error(allowed.error)
            // ADR-168 amendment: offer the apex/www twin in the same prompt so a
            // site that redirects between them needs one restart, not two. The
            // twin must pass the same ceiling and cap, or the prompt stays single.
            const twin = WebMcpProfile.counterpartOrigin(error.origin)
            const alsoOrigin =
              twin && !grantPolicy.profile.allowedOrigins.includes(twin)
                ? (await MCP.checkWebMcpOriginGrants(grantPolicy.server, [error.origin, twin])).ok
                  ? twin
                  : undefined
                : undefined
            await ctx.ask({
              permission: "webmcp",
              patterns: [key],
              always: [],
              metadata: {
                originGrant: true,
                server: grantPolicy.server,
                origin: error.origin,
                ...(alsoOrigin ? { alsoOrigin } : {}),
                allowedOrigins: [...grantPolicy.profile.allowedOrigins],
                experimental: true,
              },
            })
            // An abort while the prompt was open must not restart the browser.
            ctx.abort.throwIfAborted()
            const granted = await MCP.grantWebMcpOrigin(grantPolicy.server, error.origin, alsoOrigin)
            if (!granted.ok) throw new Error(granted.error)
            throw new Error(
              `WebMCP origin ${alsoOrigin ? `${error.origin} and ${alsoOrigin}` : error.origin} was allowed for this session and the browser bridge was restarted; open pages were closed. Retry the call.`,
            )
          }
          // The read grant refusal precedes content dispatch. T1 can continue
          // once after approval with fresh origin/policy checks (ADR-176).
          const grantRead = async (readPolicy: WebMcpProfile.Policy, error: unknown): Promise<void> => {
            if (!(error instanceof WebMcpProfile.ReadNotGrantedError)) throw error
            // A managed or disabled refusal fails here without a prompt.
            const allowed = await MCP.checkWebMcpReadGrant(readPolicy.server, error.origin)
            if (!allowed.ok) throw new Error(allowed.error)
            const metadata = { readGrant: true, server: readPolicy.server, origin: error.origin, experimental: true }
            WebMcpAutoApproval.bindBridge(metadata, readPolicy, { permission: "webmcp", patterns: [key] }, () =>
              MCP.matchesWebMcpProfile(readPolicy.server, readPolicy.profile),
            )
            const candidate = await WebMcpApprovals.capture(readPolicy, { capability: "read", origin: error.origin })
            WebMcpApprovals.bind(metadata, candidate, {
              permission: key,
              patterns: McpPermissionPattern.derive(key, { origin: error.origin }).patterns,
            })
            await ctx.ask({ permission: "webmcp", patterns: [key], always: [], metadata })
            ctx.abort.throwIfAborted()
            await checkWebMcpDenials()
            // Saved read authority stays separate from session grants so revoke
            // takes effect without reconnecting the browser.
            // Preserve the user's reply type even if another client revokes
            // the record immediately: never turn a revoked save into a new
            // temporary grant.
            const saved = WebMcpApprovals.usedSavedApproval(metadata)
            if (!saved) {
              const granted = await MCP.grantWebMcpReadOrigin(
                readPolicy.server,
                error.origin,
                readPolicy.profile,
                ctx.abort,
              )
              if (!granted.ok) throw new Error(granted.error)
            }
            if (!WebMcpProfile.READ_SCOPE_TOOLS.some((name) => name === readPolicy.toolName)) {
              // wait_for belongs to T2 and retains its explicit retry and
              // per-turn reservation semantics.
              throw new Error(
                `WebMCP read access to ${error.origin} ${saved ? "was saved for this project" : "was allowed for this session"}. Retry the call.`,
              )
            }
            WebMcpApprovals.bindReadContinuation(call as object, error.origin, async () => {
              ctx.abort.throwIfAborted()
              if (!(await MCP.matchesWebMcpProfile(readPolicy.server, readPolicy.profile))) {
                throw new Error("WebMCP bridge changed while read approval was pending; request a fresh read")
              }
              if (candidate && !(await WebMcpApprovals.valid(candidate))) {
                throw new Error("WebMCP read approval is no longer valid; request a fresh read")
              }
              if (saved && (!candidate || !(await WebMcpApprovals.allowed(candidate)))) {
                throw new Error("Saved WebMCP read approval was revoked; request a fresh read")
              }
            })
          }
          // ADR-174: a T2 call against an origin with no session interact
          // grant, or whose budget is spent, throws before the bridge acts.
          // The prompt names the origin and what the grant covers; approval
          // records (or renews) the grant in memory — never a relaunch. The
          // caller then either continues in the same call (a per-action tool
          // that asked for the grant before its own asks) or tells the model
          // to retry (a grant-covered dispatch that stopped at the grant).
          const grantInteract = async (
            interactPolicy: WebMcpProfile.Policy,
            error: WebMcpProfile.InteractNotGrantedError,
            breaker: WebMcpProfile.InteractBreaker | undefined,
          ): Promise<void> => {
            const allowed = await MCP.checkWebMcpInteractGrant(interactPolicy.server, error.origin)
            if (!allowed.ok) throw new Error(allowed.error)
            const metadata = {
              interactGrant: true,
              renewal: error.renewal,
              budget: WebMcpProfile.INTERACT_BUDGET,
              server: interactPolicy.server,
              origin: error.origin,
              experimental: true,
            }
            WebMcpAutoApproval.bindBridge(metadata, interactPolicy, { permission: "webmcp", patterns: [key] }, () =>
              MCP.matchesWebMcpProfile(interactPolicy.server, interactPolicy.profile),
            )
            try {
              await ctx.ask({
                permission: "webmcp",
                patterns: [key],
                always: [],
                metadata,
              })
            } catch (refusal) {
              if (
                breaker &&
                (refusal instanceof Permission.RejectedError || refusal instanceof Permission.CorrectedError)
              ) {
                breaker.refused(`interaction grant for ${error.origin}`)
              }
              throw refusal
            }
            // An abort while the prompt was open records neither the grant nor
            // the approval.
            ctx.abort.throwIfAborted()
            breaker?.approved()
            const granted = await MCP.grantWebMcpInteractOrigin(interactPolicy.server, error.origin)
            if (!granted.ok) throw new Error(granted.error)
          }
          let call: Record<string, unknown> | unknown = args
          if (policy) {
            try {
              call = WebMcpProfile.validateCall(policy.profile, policy.toolName, args)
            } catch (error) {
              await grantOrigin(policy, error)
            }
          }
          // Capture the approval-time origin/descriptor binding before the
          // approval is requested, so the dispatch-time preflight verifies
          // the fresh listing against what the approver saw even if another
          // session rewrites the shared baseline while approval is pending.
          // Without a listing the approval is still requested (its dialog
          // warns that nothing was listed), but the call is marked so
          // dispatch cannot fall back to a baseline another session writes
          // while approval is pending.
          if (policy?.toolName === "execute_webmcp_tool") {
            const pageId = (call as { pageId?: unknown }).pageId
            const toolName = (call as { toolName?: unknown }).toolName
            const snapshot =
              typeof pageId === "number" && typeof toolName === "string"
                ? WebMcpProfile.captureApproval(policy.profile, pageId, toolName)
                : undefined
            if (snapshot) WebMcpProfile.bindApproval(call as Record<string, unknown>, snapshot)
            else WebMcpProfile.denyApproval(call as Record<string, unknown>)
          }
          const webmcp = policy
            ? WebMcpProfile.approvalMetadata(
                policy.server,
                policy.profile,
                policy.toolName,
                call as Record<string, unknown>,
                // Page annotations describe a named page tool, so only an
                // execute call carries them; bridge operations must not
                // inherit hints from a same-named page tool.
                policy.toolName === "execute_webmcp_tool"
                  ? WebMcpProfile.annotationsFor(
                      policy.profile,
                      (call as { pageId?: number }).pageId ?? -1,
                      (call as { toolName?: string }).toolName ?? policy.toolName,
                    )
                  : undefined,
              )
            : undefined
          // ADR-171/172: read-scope calls are approved by the per-origin
          // session read grant (the dispatch raises ReadNotGrantedError for a
          // missing grant and the prompt happens then), so they skip the
          // per-call asks.
          const readTierTool =
            policy !== undefined && WebMcpProfile.READ_SCOPE_TOOLS.some((name) => name === policy.toolName)
          // ADR-174: hover, wait_for and ordinary clicks run under the
          // per-origin interact grant (the dispatch raises
          // InteractNotGrantedError and the prompt happens then); fills, key
          // presses, dialogs and escalated clicks keep the per-call asks with
          // the target and full value in the metadata.
          const interactTool = policy !== undefined && WebMcpProfile.isInteractTool(policy.toolName)
          const breaker = interactTool ? webmcpTurnBreaker(input.processor) : undefined
          if (breaker?.tripped) throw new Error(breaker.tripped)
          // A wait reservation is refunded when the call fails before its
          // request reaches the bridge (a grant prompt, a denial, a missing
          // page, an exhausted budget, an abort): nothing waited, so the
          // turn budget stays available (ADR-174 rule 9).
          let reservedWait = 0
          const refundIfNotDispatched = (dispatchCall: unknown) => {
            if (breaker && reservedWait > 0 && !WebMcpProfile.wasDispatched(dispatchCall)) {
              breaker.refundWait(reservedWait)
              reservedWait = 0
            }
          }
          if (interactTool && policy && webmcp) {
            // A target nobody listed can never be approved meaningfully and
            // would fail closed at dispatch anyway; fail it here without
            // spending the user's attention on a doomed prompt.
            const target = isRecord(webmcp.target) ? webmcp.target : undefined
            const targets = Array.isArray(webmcp.targets) ? webmcp.targets : []
            if (target?.unlisted === true || targets.some((entry) => isRecord(entry) && entry.unlisted === true)) {
              breaker?.failed(webmcpTargetSummary(webmcp))
              throw new WebMcpProfile.TargetBindingError(
                policy.toolName === "press_key"
                  ? "WebMCP press_key needs a focused control in the latest snapshot of this page; take a new snapshot or click the control first"
                  : "WebMCP target is not in the latest snapshot of this page; take a new snapshot before acting",
              )
            }
            if (policy.toolName === "wait_for") {
              const requested = (call as { timeout?: unknown }).timeout
              const waitMs = typeof requested === "number" ? requested : WebMcpProfile.MAX_WAIT_TIMEOUT_MS
              if (breaker && !breaker.reserveWait(waitMs)) {
                throw new Error(
                  `WebMCP wait_for budget for this turn (${WebMcpProfile.MAX_WAIT_PER_TURN_MS / 1000} s cumulative) is exhausted; do not retry automatically`,
                )
              }
              reservedWait = waitMs
            }
          }
          const permissionPattern = McpPermissionPattern.derive(key, webmcp ?? call, { worktree: Instance.worktree })
          const mcpMetadata = { mcp: true, ...permissionPattern.metadata }
          // Recheck both layers at admission and dispatch, including calls
          // covered by a read/session grant or a saved approval.
          const checkWebMcpDenials = async () => {
            if (!webmcp) return
            for (const request of [
              { permission: key, patterns: permissionPattern.patterns, metadata: mcpMetadata },
              { permission: "webmcp", patterns: [key], metadata: webmcp },
            ])
              await Permission.checkDenials({
                ...request,
                always: [],
                sessionID: input.session.id,
                ruleset,
                agent: input.agent.name,
              })
          }
          try {
            // Deny rules first: a call the rules forbid must not spend a grant
            // prompt (or record a grant) before it fails.
            await checkWebMcpDenials()
            const grantCovered =
              interactTool &&
              policy !== undefined &&
              !WebMcpProfile.perActionCall(policy.profile, policy.toolName, call as Record<string, unknown>)
            if (interactTool && policy) {
              // Bind the ask-time decision to the call so dispatch spends the
              // budget on exactly this decision, whatever the snapshot map
              // looks like after the bridge round-trips.
              WebMcpProfile.bindInteractDecision(call as object, !grantCovered)
              // A per-action tool on an origin with no interact grant would
              // pass both asks and then stop at the grant prompt; ask for the
              // grant first, then continue into the per-action asks and the
              // dispatch in this same call, so the user confirms the action
              // once and the model needs no retry. The snapshot origin is the
              // page origin at snapshot time; the dispatch re-checks the live
              // page.
              if (!grantCovered) {
                const pageId = (call as { pageId?: unknown }).pageId
                const origin =
                  typeof pageId === "number"
                    ? WebMcpProfile.pageOriginOf(WebMcpProfile.snapshotUrlFor(policy.profile, pageId))
                    : undefined
                if (origin && !(policy.interactGrants?.() ?? new Map<string, number>()).has(origin)) {
                  await grantInteract(policy, new WebMcpProfile.InteractNotGrantedError(origin), breaker)
                }
              }
            }
            const skipPerCall = readTierTool || grantCovered
            // Again after the grant prompt: a deny rule written while that
            // prompt was open must stop the call before its own asks (the
            // dispatch re-checks once more through the bound call).
            await checkWebMcpDenials()
            if (policy?.toolName === "close_page" && webmcp && policy.closePageOrigin) {
              ctx.abort.throwIfAborted()
              const origin = await policy.closePageOrigin((call as { pageId: number }).pageId, ctx.abort)
              if (origin) webmcp.pageOrigin = origin
              WebMcpApprovals.bindCloseTarget(call as { pageId: number }, origin)
            }
            const approvalCandidate =
              policy && webmcp ? await WebMcpApprovals.captureCall(policy, call as Record<string, unknown>) : undefined
            if (webmcp) {
              WebMcpApprovals.bind(webmcp, approvalCandidate, { permission: key, patterns: permissionPattern.patterns })
              WebMcpApprovals.bind(mcpMetadata, approvalCandidate, {
                permission: key,
                patterns: permissionPattern.patterns,
              })
              if (policy) {
                const valid = () => MCP.matchesWebMcpProfile(policy.server, policy.profile)
                WebMcpAutoApproval.bindBridge(webmcp, policy, { permission: "webmcp", patterns: [key] }, valid)
                WebMcpAutoApproval.bindBridge(
                  mcpMetadata,
                  policy,
                  { permission: key, patterns: permissionPattern.patterns },
                  valid,
                  webmcp,
                )
              }
            }
            try {
              if (!skipPerCall) {
                await ctx.ask({
                  permission: key,
                  metadata: mcpMetadata,
                  patterns: permissionPattern.patterns,
                  always: permissionPattern.always,
                })
              }
              if (webmcp && !skipPerCall) {
                await ctx.ask({
                  permission: "webmcp",
                  patterns: [key],
                  always: [],
                  metadata: webmcp,
                })
              }
            } catch (refusal) {
              if (
                breaker &&
                (refusal instanceof Permission.RejectedError || refusal instanceof Permission.CorrectedError)
              ) {
                breaker.refused(webmcpTargetSummary(webmcp))
              }
              throw refusal
            }
            if (webmcp) WebMcpApprovals.bindCall(call as object, webmcp, checkWebMcpDenials)
            if (breaker && !skipPerCall) breaker.approved()
            try {
              const outcome = await execute(call, opts)
              breaker?.succeeded()
              return outcome
            } catch (error) {
              // A redirect target the bridge blocked surfaces only after
              // dispatch; offer the same grant the call-time path would.
              if (policy) {
                if (error instanceof WebMcpProfile.ReadNotGrantedError) {
                  await grantRead(policy, error)
                  await checkWebMcpDenials()
                  ctx.abort.throwIfAborted()
                  await WebMcpApprovals.checkReadContinuation(call as object, error.origin)
                  // Exactly one continuation outside this catch. Any bridge
                  // failure or a second grant refusal propagates, never loops.
                  return await execute(call, opts)
                } else if (error instanceof WebMcpProfile.InteractNotGrantedError) {
                  // The dispatch stopped before the bridge acted; the grant
                  // is recorded now and the model retries the same call.
                  await grantInteract(policy, error, breaker)
                  throw new WebMcpProfile.GrantRetryError(
                    `WebMCP interaction with ${error.origin} was ${error.renewal ? "renewed" : "allowed"} for this session (${WebMcpProfile.INTERACT_BUDGET} grant-covered actions). Retry the call.`,
                  )
                } else {
                  if (breaker && error instanceof WebMcpProfile.TargetBindingError) {
                    breaker.failed(webmcpTargetSummary(webmcp))
                  }
                  await grantOrigin(policy, error)
                }
              }
              throw error
            }
          } catch (error) {
            refundIfNotDispatched(call)
            throw error
          }
        },
      })

      if (nestedBrowser) nestedBrowser.result = result
      const { textParts, attachments } = collectMcpToolResult(result)

      // ADR-206: regular MCP server output is wrapped in the untrusted-content
      // envelope (source is the `server:tool` key). WebMCP browser tools keep
      // their own established labeling — the envelope is never applied twice.
      const outputText = textParts.length
        ? item.webmcp
          ? `[Untrusted MCP tool content from ${key}]\n\n${textParts.join("\n\n")}`
          : wrapUntrustedContent(textParts.join("\n\n"), key)
        : ""
      // Each side capped separately, then joined: Truncate.output persists
      // everything it receives, so an unbounded side would bypass the text
      // budget, while a single shared cap would let hostile output squeeze
      // trusted hook feedback out entirely.
      const combined =
        hookFeedback === undefined
          ? boundMcpResultText(outputText)
          : `${boundMcpResultText(outputText)}${boundMcpHookFeedback(hookFeedback)}`
      const truncated = await Truncate.output(combined, {}, input.agent)
      const metadata = mcpResultPartMetadata(result, truncated)

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

  if (
    Object.values(mcpTools).some((item) => item.webmcp) &&
    !isDisabledByConfig("browser_workflow") &&
    !Permission.disabled(["browser_workflow"], ruleset).has("browser_workflow")
  ) {
    if (Object.hasOwn(tools, "browser_workflow")) throw new Error("Browser workflow conflicts with an existing tool")
    const admittedBrowserTools = new Map(
      Object.entries(mcpTools)
        .filter(([key, item]) => item.webmcp && tools[key])
        .map(([key, item]) => [key, { policy: item.webmcp!, wrapped: tools[key]! }]),
    )
    tools.browser_workflow = tool({
      description: BrowserWorkflow.description,
      inputSchema: jsonSchema(ProviderTransform.schema(input.model, z.toJSONSchema(BrowserWorkflow.Parameters)) as any),
      async execute(raw, options) {
        const args = BrowserWorkflow.Parameters.parse(raw)
        const ctx = context(args, options)
        const release = await ToolWriteGate.acquire(ctx.sessionID, "exclusive", ctx.abort)
        using _lane = defer(release)
        let sequence = 0
        return runToolLifecycle({
          toolID: "browser_workflow",
          sessionID: ctx.sessionID,
          callID: options.toolCallId,
          args,
          cwd: Instance.directory,
          ask: (request) => ctx.ask(request),
          execute: () =>
            BrowserWorkflow.execute(BrowserWorkflow.Parameters.parse(args), {
              context: ctx,
              registry: registryDispatcher!,
              selectionModel: `${input.model.providerID}/${input.model.id}`,
              selectionUnavailable: isKnownCliProviderID(input.model.providerID)
                ? "Tool selection evaluation requires an API model; CLI providers can execute their own tools outside this evaluator"
                : undefined,
              async select(prompt, signal) {
                if (isKnownCliProviderID(input.model.providerID))
                  throw new Error("CLI model cannot guarantee no-tool evaluation")
                const { generateText } = await import("ai")
                const language = await Provider.getLanguage(input.model)
                const result = await generateText({
                  model: language,
                  maxRetries: 0,
                  maxOutputTokens: Math.min(2048, ProviderTransform.auxMaxOutputTokens(input.model)),
                  abortSignal: signal,
                  tools: {},
                  toolChoice: "none",
                  system: BrowserSelection.SYSTEM,
                  prompt,
                })
                return result.text
              },
              async connection(server) {
                const entries = [...admittedBrowserTools.values()].filter((entry) => entry.policy.server === server)
                const profile = entries[0]?.policy.profile
                if (!profile || !(await MCP.matchesWebMcpProfile(server, profile)))
                  throw new Error("Browser bridge changed or disconnected; resolve tools again")
                return { identity: profile, profile, tools: entries.map((entry) => entry.policy.toolName) }
              },
              requireBridge(server) {
                const found = [...admittedBrowserTools.values()].find((entry) => entry.policy.server === server)
                if (
                  !found ||
                  !found.policy.profile.read ||
                  !found.policy.profile.interact ||
                  found.policy.profile.persistentProfile
                )
                  throw new Error("Browser workflow needs a connected isolated read/interact WebMCP bridge")
              },
              async browser(server, name, parameters, signal) {
                const entry = [...admittedBrowserTools.values()].find(
                  (entry) => entry.policy.server === server && entry.policy.toolName === name,
                )
                if (!entry?.wrapped.execute) throw new Error("Required browser tool is disabled or unavailable")
                const nested = {
                  toolCallId: `${options.toolCallId}:browser:${++sequence}`,
                  messages: options.messages,
                  abortSignal: signal,
                }
                const capture: { result?: unknown } = {}
                browserCalls.set(nested, capture)
                try {
                  try {
                    await entry.wrapped.execute(parameters, nested)
                  } catch (error) {
                    if (!(error instanceof WebMcpProfile.GrantRetryError)) throw error
                    // The grant path never dispatched the action. One continuation only.
                    await entry.wrapped.execute(parameters, nested)
                  }
                  if (capture.result === undefined) throw new Error("Browser operation produced no runtime evidence")
                  return capture.result
                } finally {
                  browserCalls.delete(nested)
                }
              },
            }),
        })
      },
    })
  }

  const discoveryEnabled = (await Config.get()).experimental?.mcp_tool_discovery === true
  // Revoke selections even when the entire admitted catalog disappears.
  const visible = ToolDiscovery.visible(input.session.id, discoveryEnabled ? discoveryCatalog : [])
  if (
    discoveryEnabled &&
    discoveryCatalog.length > 0 &&
    !isDisabledByConfig("tool_search") &&
    !Permission.disabled(["tool_search"], ruleset).has("tool_search")
  ) {
    if (Object.hasOwn(tools, "tool_search"))
      throw new Error("MCP discovery conflicts with an existing tool_search tool")
    for (const entry of discoveryCatalog) if (!visible.has(entry.name)) delete tools[entry.name]
    tools.tool_search = tool({
      description: ToolDiscovery.description(discoveryCatalog),
      inputSchema: ToolDiscovery.Query,
      async execute(args, options) {
        const ctx = context(args, options)
        return runToolLifecycle({
          toolID: "tool_search",
          sessionID: ctx.sessionID,
          callID: ctx.callID,
          args,
          cwd: Instance.directory,
          ask: (req) => ctx.ask(req),
          execute: async () => {
            ctx.abort.throwIfAborted()
            await ctx.ask({ permission: "tool_search", patterns: [args.query], always: ["*"], metadata: {} })
            ctx.abort.throwIfAborted()
            const result = ToolDiscovery.search(ctx.sessionID, discoveryCatalog, args)
            return {
              title: `Discovered ${result.tools.length} tools`,
              metadata: { count: result.tools.length },
              output: JSON.stringify(result),
            }
          },
        })
      },
    })
  }
  return tools
}
