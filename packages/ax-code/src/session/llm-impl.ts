import { Installation } from "@/installation"
import { providerModelKey } from "@/provider/model-key"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import {
  streamText,
  wrapLanguageModel,
  type ModelMessage,
  type StreamTextResult,
  type Tool,
  type ToolSet,
  tool,
  jsonSchema,
} from "ai"
import { mergeDeep, pipe } from "remeda"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { ScopedFlag } from "@/flag/scoped"
import { Permission } from "@/permission"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { Env } from "@/util/env"
import { withTimeout } from "@/util/timeout"
import { Recorder } from "@/replay/recorder"
import { AgentControl } from "@/control-plane/agent-control"
import { AgentControlEvents } from "@/control-plane/agent-control-events"
import { isNonEmptyRecord } from "@/util/record"
import { SuperLongPolicy } from "./super-long-policy"
import { SuperLongRuntime } from "./super-long-runtime"
import { longAgentProfileForModel } from "@/provider/agent-optimization-profile"
import { getModelCapabilities } from "@/provider/model-capabilities"
import { PromptCachePolicy } from "@/provider/prompt-cache-policy"
import { LongAgentContextPacker } from "@/context/long-agent-packer"
import { permissionRulesetFromLegacyTools } from "./prompt-permission"
import { resolvePromptIsolationPolicy } from "./prompt-runtime-policy"
import { AX_ENGINE_PROVIDER_ID } from "@/provider/ax-engine/constants"
import { attachThinkTagStream } from "@/provider/think-tags"
import { isKnownCliProviderID } from "@/provider/cli/ids"
import { isRetiredProviderID } from "@/provider/retired-providers"

import { ReasoningPolicy } from "@/control-plane/reasoning-policy"
import { RequestProvenance } from "./request-provenance"

export namespace LLM {
  const log = Log.create({ service: "llm" })
  const SUPER_LONG_PACING_MAX_ENTRIES = 64
  const superLongPacing = new Map<string, SuperLongPolicy.PacingState>()

  /** LRU-capped setter for superLongPacing to prevent unbounded growth. */
  function setPacingEntry(key: string, state: SuperLongPolicy.PacingState) {
    // Delete first so re-insertion moves to end (most-recent).
    superLongPacing.delete(key)
    superLongPacing.set(key, state)
    while (superLongPacing.size > SUPER_LONG_PACING_MAX_ENTRIES) {
      const oldest = superLongPacing.keys().next().value
      if (oldest === undefined) break
      superLongPacing.delete(oldest)
    }
  }
  const TOOL_NAME_ALIASES: Record<string, string> = {
    list_directory: "list",
    list_dir: "list",
    ls: "list",
  }

  export type StreamInput = {
    user: MessageV2.User
    sessionID: MessageV2.User["sessionID"]
    model: Provider.Model
    agent: Agent.Info
    permission?: Permission.Ruleset
    system: string[]
    abort: AbortSignal
    messages: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
    toolChoice?: "auto" | "required" | "none"
    config?: Awaited<ReturnType<typeof Config.get>>
    /**
     * Optional hard ceiling for this request only. Used for local-engine
     * truncated-turn recovery so soft "keep it short" instructions cannot burn
     * multi-minute full max_tokens windows when the model ignores them.
     */
    maxOutputTokens?: number
    /** Replay correlation for the final AX/AI-SDK pre-adapter request boundary. */
    replay?: {
      messageID?: string
      stepIndex?: number
    }
  }

  export type StreamOutput = StreamTextResult<ToolSet, any>

  const STREAM_ERROR = Symbol("ax-code.llm.streamError")
  const DEFAULT_SETUP_TIMEOUT_MS = 90_000
  const LOCAL_ENGINE_SETUP_TIMEOUT_MS = 300_000

  // The AI SDK reports stream errors through the `onError` callback WITHOUT
  // throwing, so a stream that errors mid-flight still completes its async
  // iterator and surfaces a default `finishReason: "other"` with no usage — i.e.
  // an "empty model turn". Capturing the cause here lets the loop explain *why*
  // the turn came back empty instead of reporting a bare, unattributable stall.
  export function lastStreamError(output: StreamOutput): unknown {
    return (output as { [STREAM_ERROR]?: unknown })[STREAM_ERROR]
  }

  export function repairedToolName(toolName: string, tools: Record<string, unknown>): string | undefined {
    const lower = toolName.toLowerCase()
    const snake = lower.replace(/[-\s]+/g, "_")
    const candidates = [lower, snake, TOOL_NAME_ALIASES[lower], TOOL_NAME_ALIASES[snake]]

    for (const candidate of candidates) {
      if (!candidate || candidate === toolName) continue
      if (tools[candidate]) return candidate
    }
    return undefined
  }

  export async function stream(input: StreamInput) {
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
      .tag("mode", input.agent.mode)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    // Early abort check — if the signal was already fired (e.g. user pressed
    // Ctrl-C during retry sleep), bail out before starting the expensive
    // getLanguage/getSDK/streamText pipeline.
    if (input.abort?.aborted) {
      throw new DOMException("Aborted", "AbortError")
    }
    // 90s default: getLanguage() may call getSDK() with its own 60s install
    // timeout. Local ax-engine gets a wider envelope because startup can queue
    // behind a cross-process model load before it can report its own error.
    const setupTimeoutMs =
      input.model.providerID === "ax-engine" ? LOCAL_ENGINE_SETUP_TIMEOUT_MS : DEFAULT_SETUP_TIMEOUT_MS
    const [language, cfg, provider] = await withTimeout(
      Promise.all([
        Provider.getLanguage(input.model),
        input.config ?? Config.get(),
        Provider.getProvider(input.model.providerID),
      ]),
      setupTimeoutMs,
      `LLM setup timed out for ${input.model.providerID}/${input.model.id} — provider may be unreachable`,
    )

    const reasoningPolicyDecision = ReasoningPolicy.decide({
      small: input.small,
      autonomous: ScopedFlag.autonomous(),
      requestedDepth: input.user.requestedDepth,
      userVariant: input.user.variant,
      model: input.model,
      agent: input.agent,
      providerOptions: provider?.options,
      messages: input.messages,
    })
    if (reasoningPolicyDecision.checkpoint) {
      Recorder.emit(
        AgentControlEvents.reasoningSelected({
          sessionID: input.sessionID,
          depth: reasoningPolicyDecision.depth,
          reason: reasoningPolicyDecision.reason ?? "policy_selected",
          policyVersion: "v4-bridge",
          checkpoint: reasoningPolicyDecision.checkpoint,
        }),
      )
    }
    if (input.agent.name === "plan") {
      Recorder.emit(
        AgentControlEvents.phaseChanged({
          sessionID: input.sessionID,
          previousPhase: "assess",
          phase: "plan",
          reason: "plan_mode",
          deterministic: false,
        }),
      )
      Recorder.emit(
        AgentControlEvents.planCreated({
          sessionID: input.sessionID,
          deterministic: false,
          plan: AgentControl.createShadowPlan({
            id: `plan_${input.sessionID}`,
            objective:
              ReasoningPolicy.objective(input.messages) || reasoningPolicyDecision.objective || "Plan mode session",
            ownerAgent: input.agent.name,
            reason: "plan_mode",
          }),
        }),
      )
    }

    // Build labeled cache blocks up front so stable and dynamic system content
    // can be cached independently. Stable blocks stay at the front so the
    // provider-side cache prefix is not invalidated by per-turn dynamic text.
    const cacheBlocks: PromptCachePolicy.CacheBlock[] = []
    const system: string[] = []
    const joined = SystemPrompt.request({
      agent: input.agent,
      model: input.model,
      system: input.system,
      userSystem: input.user.system,
    }).join("\n")
    if (joined) {
      system.push(joined)
      cacheBlocks.push({ kind: "stable", label: "system", content: joined })
    }
    const reasoningPolicyReminder = ReasoningPolicy.systemReminder(reasoningPolicyDecision)
    if (reasoningPolicyReminder) {
      system.push(reasoningPolicyReminder)
      cacheBlocks.push({ kind: "dynamic", label: "transient", content: reasoningPolicyReminder })
    }

    const longAgentProfile = longAgentProfileForModel(input.model.id, input.model.providerID)
    const autonomousEnabled = ScopedFlag.autonomous()
    const SUPER_LONG_REMINDER =
      "You are operating in Super-Long mode. Before declaring any task complete: run available tests or verification commands, confirm the build is clean, and surface any repeated failure patterns explicitly rather than retrying silently."
    const superLongEnabled =
      !input.small &&
      autonomousEnabled &&
      SuperLongPolicy.runtimeState({
        modelID: input.model.id,
        // providerID must flow into the capability-based model default
        // (supportsLongAgent): provider-filtered registry entries never match
        // when providerID is omitted, so dropping it here could pace/remind a
        // run the prompt loop's deadline enforcement (which passes providerID)
        // never treats as Super-Long — or vice versa.
        providerID: input.model.providerID,
        config: SuperLongPolicy.fromConfig(cfg.super_long),
        scoped: ScopedFlag.superLong(),
      }).enabled
    // The verification-loop reminder is provider-agnostic supervision text —
    // it must fire for every Super-Long run, not just models whose long-agent
    // profile enables the extra request shaping below. Gating it on the
    // profile left Super-Long with no observable behavior on non-Qwen models.
    if (superLongEnabled) {
      system.push(SUPER_LONG_REMINDER)
      cacheBlocks.push({ kind: "stable", label: "stable-rules", content: SUPER_LONG_REMINDER })
    }

    const prePluginSystem = [...system]
    await Plugin.trigger(
      "experimental.chat.system.transform",
      { sessionID: input.sessionID, model: input.model },
      { system },
    )
    // If the plugin modified the system array, we can no longer trust the
    // original stable/dynamic labels, so treat the transformed content as stable.
    if (system.length !== prePluginSystem.length || system.some((s, i) => s !== prePluginSystem[i])) {
      cacheBlocks.length = 0
      for (const [i, content] of system.entries()) {
        cacheBlocks.push({ kind: "stable", label: i === 0 ? "system" : "stable-rules", content })
      }
    }

    const variant =
      !input.small && input.model.variants && input.user.variant ? (input.model.variants[input.user.variant] ?? {}) : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider?.options ?? {},
          longAgent: superLongEnabled && longAgentProfile.preserveThinkingEligible,
        })
    const options: Record<string, any> = ProviderTransform.sanitizeOptions(
      input.model,
      pipe(
        base,
        mergeDeep(input.model.options),
        mergeDeep(input.agent.options),
        mergeDeep(variant),
        mergeDeep(reasoningPolicyDecision.options),
      ),
    )
    // Phase 4: build and inject a long-agent context pack for Super-Long runs.
    // The token budget follows the model profile (wide for Qwen3.7-Max,
    // narrow otherwise) — the pack itself is provider-agnostic prompt text.
    // Keep existing system instructions outside the pack to avoid duplicating
    // the provider prompt.
    if (superLongEnabled) {
      const task = extractLastUserTask(input.messages)
      const touchedFiles = extractTouchedFiles(input.messages)
      const packResult = LongAgentContextPacker.pack({
        tokenBudget: longAgentProfile.contextPackTokenBudget,
        task: task ?? undefined,
        touchedFiles,
        toolConstraints:
          "Use available tools deliberately. Verify meaningful code changes before reporting completion.",
      })
      const renderedContext = LongAgentContextPacker.render(packResult)
      if (renderedContext) {
        const packText = ["## Long-Agent Context Pack", renderedContext].join("\n")
        system.push(packText)
        cacheBlocks.push({ kind: "dynamic", label: "transient", content: packText })
      }
      l.info("long-agent context pack", {
        debugSummary: packResult.debugSummary,
        touchedCount: touchedFiles.length,
      })
    }

    // Classify finalized system blocks and apply provider-specific cache
    // annotations whenever the model reports prompt-cache support. Super-Long
    // used to be the only caller; that left ordinary PAI/Kimi turns sending
    // a 36k system prefix with cache.read = 0.
    //
    // For providers whose chat template collapses all system turns into a single
    // leading system message (Qwen 3.x / Ornith / Holo3 / MiniMax / DeepSeek),
    // keep only the stable blocks in system. Append dynamic blocks to the last
    // user message so they are not merged into the cached system prefix and
    // re-written every turn.
    const cacheCaps = getModelCapabilities(input.model.id, input.model.providerID)
    const promptCacheEligible = cacheCaps.promptCache === "supported" || cacheCaps.promptCache === "experimental"
    const collapseSystem = ProviderTransform.requiresSingleLeadingSystem(input.model)
    let requestMessages = input.messages
    let blocksForRender = cacheBlocks
    if (collapseSystem) {
      const dynamicText = cacheBlocks
        .filter((b) => b.kind === "dynamic")
        .map((b) => b.content)
        .filter(Boolean)
        .join("\n\n")
      if (dynamicText) {
        requestMessages = appendDynamicTextToLastUserMessage(input.messages, dynamicText)
      }
      blocksForRender = cacheBlocks.filter((b) => b.kind === "stable")
    }

    let systemMessages: ModelMessage[]
    if (promptCacheEligible) {
      const cacheResult = PromptCachePolicy.render(blocksForRender, input.model.providerID)
      systemMessages = cacheResult.blocks.map((block) =>
        systemMessage(block.content, cacheResult.mode, block.cacheControl),
      )
      if (cacheResult.mode !== "off") {
        l.info("prompt cache policy active", {
          mode: cacheResult.mode,
          stableBlocks: cacheResult.blocks.filter((b) => b.cacheControl !== undefined).length,
          totalBlocks: cacheResult.blocks.length,
        })
      }
    } else {
      systemMessages = blocksForRender.map((block) => systemMessage(block.content))
    }

    const messages = [...systemMessages, ...requestMessages]

    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        options,
      },
    )
    const paramsOptions = ProviderTransform.sanitizeOptions(input.model, params.options)
    const providerOptions = ProviderTransform.providerOptions(input.model, paramsOptions)

    const { headers } = await Plugin.trigger(
      "chat.headers",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        headers: {},
      },
    )

    const modelMaxOutputTokens = ProviderTransform.maxOutputTokens(input.model)
    const maxOutputTokens =
      typeof input.maxOutputTokens === "number" && Number.isFinite(input.maxOutputTokens) && input.maxOutputTokens > 0
        ? Math.min(modelMaxOutputTokens, Math.floor(input.maxOutputTokens))
        : modelMaxOutputTokens

    const supportsToolCalls = input.model.capabilities.toolcall !== false
    // A forced text-only turn should not pay to serialize and prefill every tool
    // schema. This matters especially for local models, where the schemas can add
    // thousands of tokens to a turn whose sole purpose is to synthesize an answer.
    const toolsEnabled = supportsToolCalls && input.toolChoice !== "none"
    const tools = toolsEnabled ? await resolveTools(input, cfg) : {}

    // LiteLLM and some Anthropic proxies require the tools parameter to be present
    // when message history contains tool calls, even if no tools are being used.
    // Add a dummy tool that is never called to satisfy this validation.
    // This is enabled for:
    // 1. Providers with "litellm" in their ID or API ID (auto-detected)
    // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
    const isLiteLLMProxy =
      provider.options?.["litellmProxy"] === true ||
      input.model.providerID.toLowerCase().includes("litellm") ||
      input.model.api.id.toLowerCase().includes("litellm")

    if (isLiteLLMProxy && !isNonEmptyRecord(tools) && hasToolCalls(input.messages)) {
      tools["_noop"] = tool({
        description:
          "Placeholder for LiteLLM/Anthropic proxy compatibility - required when message history contains tool calls but no active tools are needed",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }
    const activeToolNames = supportsToolCalls ? Object.keys(tools).filter((name) => name !== "invalid") : []

    if (input.replay && Recorder.active(input.sessionID)) {
      const baseEvent = {
        type: "llm.request" as const,
        sessionID: input.sessionID,
        messageID: input.replay.messageID,
        stepIndex: input.replay.stepIndex,
        model: providerModelKey({ providerID: input.model.providerID, modelID: input.model.id }),
        messageCount: input.messages.length,
        temperature: params.temperature,
      }
      try {
        const provenance = await RequestProvenance.build({
          providerID: input.model.providerID,
          modelID: input.model.id,
          systemMessages,
          messages,
          tools,
          activeToolNames,
          options: {
            temperature: params.temperature,
            topP: params.topP,
            topK: params.topK,
            toolChoice: supportsToolCalls ? input.toolChoice : "none",
            maxOutputTokens,
            retries: input.retries ?? 0,
            reasoningDepth: reasoningPolicyDecision.depth,
            variant: input.user.variant,
            providerOptions,
          },
        })
        Recorder.emit({
          ...baseEvent,
          ...provenance,
        })
      } catch (error) {
        // Evidence generation is best-effort and must not block an otherwise
        // valid request. The boundary intentionally excludes headers and raw
        // content from the persisted event.
        // Do not log the raw exception/cause: schema resolvers and proxy
        // getters can embed request content in their error text.
        l.warn("failed to build request provenance", { errorCode: "manifest_unavailable" })
        Recorder.emit({ ...baseEvent, provenanceErrorCode: "manifest_unavailable" })
      }
    }

    const pacingReservation = await applySuperLongPacing({
      enabled: superLongEnabled,
      providerID: input.model.providerID,
      modelID: input.model.id,
      sessionID: input.sessionID,
      small: input.small,
      abort: input.abort,
      baseURL: typeof provider.options?.baseURL === "string" ? provider.options.baseURL : undefined,
      pacingGraceMs: SuperLongPolicy.pacingGraceMs(SuperLongPolicy.fromConfig(cfg.super_long)),
    })

    let requestHeaders: Record<string, string> = {
      ...(input.model.providerID.startsWith("ax-code")
        ? {
            "x-ax-code-project": Instance.project.id,
            "x-ax-code-session": input.sessionID,
            "x-ax-code-request": input.user.id,
            "x-ax-code-client": Flag.AX_CODE_CLIENT,
          }
        : {
            "User-Agent": `ax-code/${Installation.VERSION}`,
          }),
      ...input.model.headers,
      ...headers,
    }
    const streamErrorHolder: { error?: unknown } = {}
    // Stream watchdog: providers can either stop producing chunks without
    // closing the connection or keep producing runaway reasoning forever.
    // Bound both failure modes while allowing local tool execution to pause
    // the clocks below.
    const idleTimeoutMs = streamIdleTimeoutMs(input.model.providerID, input.agent)
    const maxDurationMs = streamMaxDurationMs(input.model.providerID)
    const idleAbort = new AbortController()
    const streamAbort = input.abort ? AbortSignal.any([input.abort, idleAbort.signal]) : idleAbort.signal
    let output: StreamOutput
    try {
      output = streamText({
        onError(error) {
          streamErrorHolder.error = error
          l.error("stream error", {
            error: DiagnosticLog.redactForLog(error),
          })
        },
        async experimental_repairToolCall(failed) {
          const repaired = repairedToolName(failed.toolCall.toolName, tools)
          if (repaired) {
            l.info("repairing tool call", {
              tool: failed.toolCall.toolName,
              repaired,
            })
            return {
              ...failed.toolCall,
              toolName: repaired,
            }
          }
          return {
            ...failed.toolCall,
            input: JSON.stringify({
              tool: failed.toolCall.toolName,
              error: failed.error.message,
            }),
            toolName: "invalid",
          }
        },
        temperature: params.temperature,
        topP: params.topP,
        topK: params.topK,
        providerOptions,
        activeTools: activeToolNames,
        tools,
        toolChoice: supportsToolCalls ? input.toolChoice : "none",
        maxOutputTokens,
        abortSignal: streamAbort,
        headers: requestHeaders,
        maxRetries: input.retries ?? 0,
        messages,
        model: wrapLanguageModel({
          model: language as any,
          middleware: [
            {
              specificationVersion: "v3" as const,
              async transformParams(args: any) {
                if (args.type === "stream") {
                  args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
                }
                return args.params
              },
            },
          ],
        }),
        experimental_telemetry: {
          isEnabled: cfg.experimental?.openTelemetry,
          metadata: {
            userId: cfg.username ?? "unknown",
            sessionId: input.sessionID,
          },
        },
      })
    } catch (error) {
      if (pacingReservation) await releaseSuperLongPacingReservation(pacingReservation)
      throw error
    }
    // Expose the (non-throwing) stream error captured by onError so the loop can
    // attribute an empty/missing-usage turn to its underlying provider failure.
    // Read through the pacing proxy via Reflect.get, which falls through to here.
    Object.defineProperty(output, STREAM_ERROR, {
      get: () => streamErrorHolder.error,
      enumerable: false,
      configurable: true,
    })
    // Watchdog goes inside the pacing wrapper so a pre-first-chunk stall still
    // releases the pacing reservation through the pacing iterator's catch path.
    const guarded = attachStreamIdleWatchdog(output, {
      idleAbort,
      idleTimeoutMs,
      maxDurationMs,
      providerID: input.model.providerID,
      modelID: input.model.id,
    })
    const thinkTagStream = attachThinkTagStream(guarded, {
      assumePrefilledThinkBlock: ProviderTransform.assumesPrefilledThinkBlock(input.model, paramsOptions),
    })
    return attachSuperLongPacingReservation(thinkTagStream, pacingReservation, input.abort)
  }

  export type SuperLongPacingReservation = {
    key: string
    timestamp: number
    durable: boolean
  }

  // Sessions whose pacing grace window has already elapsed — checked once,
  // then latched so the durable-store read isn't repeated on every request.
  const superLongGraceElapsed = new Set<string>()

  async function applySuperLongPacing(input: {
    enabled: boolean
    providerID: string
    modelID: string
    sessionID: string
    small?: boolean
    abort: AbortSignal
    baseURL?: string
    policy?: SuperLongPolicy.PacingPolicy
    // Grace window from run start before pacing engages. Applied only when
    // provided (production always passes it); tests that omit it keep the
    // historical pace-immediately behavior.
    pacingGraceMs?: number
    now?: () => number
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  }): Promise<SuperLongPacingReservation | undefined> {
    if (!input.enabled || input.small) return
    const key = superLongPacingKey(input)
    const policy =
      input.policy ??
      SuperLongPolicy.providerPacing(input.providerID, { baseURL: input.baseURL, modelID: input.modelID })
    if (!policy) return
    if (input.pacingGraceMs !== undefined && input.pacingGraceMs > 0 && !superLongGraceElapsed.has(input.sessionID)) {
      // peek, never touch: pacing must not start the 72h clock — the prompt
      // loop's deadline enforcement owns run creation. A session without a
      // durable run yet is by definition inside its grace window.
      const startedAt = await SuperLongRuntime.peekSessionStartedAt(input.sessionID).catch(() => undefined)
      const now = input.now?.() ?? Date.now()
      if (startedAt === undefined || now - startedAt < input.pacingGraceMs) {
        return
      }
      superLongGraceElapsed.add(input.sessionID)
    }
    const durablePacingDisabled = isSuperLongDurablePacingDisabled()
    const inMemoryOnly =
      durablePacingDisabled || input.policy !== undefined || input.now !== undefined || input.sleep !== undefined
    while (true) {
      const now = input.now?.() ?? Date.now()
      let decision: SuperLongPolicy.PacingDecision
      let reservedState: SuperLongPolicy.PacingState | undefined
      let durableReserved = false
      if (inMemoryOnly) {
        const reservation = reserveProcessLocalSuperLongPacing({ key, now, policy })
        decision = reservation.decision
        reservedState = reservation.state
      } else {
        const reservation = await SuperLongRuntime.reservePacing({ key, now, policy }).catch((error) => {
          log.warn("failed to reserve durable super-long pacing; falling back to process-local pacing", {
            providerID: input.providerID,
            modelID: input.modelID,
            sessionID: input.sessionID,
            error,
          })
        })
        if (reservation) {
          decision = reservation.decision
          reservedState = reservation.state
          if (reservedState) {
            durableReserved = true
            setPacingEntry(key, reservedState)
          }
        } else {
          const localReservation = reserveProcessLocalSuperLongPacing({ key, now, policy })
          decision = localReservation.decision
          reservedState = localReservation.state
        }
      }
      if (decision.waitMs > 0) {
        log.info("super-long provider pacing wait", {
          providerID: input.providerID,
          modelID: input.modelID,
          sessionID: input.sessionID,
          waitMs: decision.waitMs,
          reason: decision.reason,
        })
        await (input.sleep ?? sleep)(decision.waitMs, input.abort)
        continue
      }
      return { key, timestamp: reservedState?.timestamps.at(-1) ?? now, durable: durableReserved }
    }
  }

  function reserveProcessLocalSuperLongPacing(input: {
    key: string
    now: number
    policy: SuperLongPolicy.PacingPolicy
  }): { decision: SuperLongPolicy.PacingDecision; state?: SuperLongPolicy.PacingState } {
    const state = superLongPacing.get(input.key) ?? { timestamps: [] }
    const decision = SuperLongPolicy.evaluatePacing({ now: input.now, state, policy: input.policy })
    if (decision.waitMs > 0) {
      setPacingEntry(input.key, { timestamps: decision.timestamps })
      return { decision }
    }

    const next = SuperLongPolicy.recordRequest({ now: input.now, state, policy: input.policy })
    setPacingEntry(input.key, next)
    return { decision, state: next }
  }

  // 5 minutes of zero chunks: generous enough for long server-side prefill on
  // 1M-context requests (which emit nothing while the provider processes the
  // prompt), short enough that a dead connection surfaces as an error instead
  // of an indefinite hang. Override with AX_CODE_STREAM_IDLE_TIMEOUT_MS
  // (0 disables the watchdog).
  const STREAM_IDLE_TIMEOUT_MS = 300_000
  // Local MLX emits no chunks during prompt prefill. A large but valid local
  // context can exceed five minutes, and aborting it leaves the single engine
  // slot occupied briefly while an automatic replay receives 429s. Keep a
  // watchdog, but give local inference enough time to produce its first chunk.
  const AX_ENGINE_STREAM_IDLE_TIMEOUT_MS = 900_000
  // CLI providers (claude-code, codex-cli, …) often start long-running local
  // commands (dev servers) and go quiet on the model stream while the child
  // is still healthy. Use a longer default idle window so live-runs are not
  // aborted as "stalled" mid-server-start (#382). Env override still wins.
  const CLI_STREAM_IDLE_TIMEOUT_MS = 900_000
  // A stream that continuously emits chunks never trips the idle watchdog.
  // Bound active model-generation time as a second line of defense. Local and
  // CLI providers get a wider window because they can generate substantially
  // more slowly than hosted APIs. Local tool execution pauses this deadline.
  const STREAM_MAX_DURATION_MS = 600_000
  const AX_ENGINE_STREAM_MAX_DURATION_MS = 3_600_000
  const CLI_STREAM_MAX_DURATION_MS = 3_600_000

  export function isCliProviderID(providerID: string | undefined): boolean {
    if (!providerID || isRetiredProviderID(providerID)) return false
    return providerID.endsWith("-cli") || isKnownCliProviderID(providerID)
  }

  export function streamIdleTimeoutMs(providerID?: string, agent?: { streamIdleTimeoutMs?: number }): number {
    const raw = process.env["AX_CODE_STREAM_IDLE_TIMEOUT_MS"]
    if (raw !== undefined && raw !== "") {
      const parsed = Number(raw)
      if (Number.isFinite(parsed) && parsed >= 0) return parsed
    }
    if (agent?.streamIdleTimeoutMs !== undefined) return agent.streamIdleTimeoutMs
    if (providerID === AX_ENGINE_PROVIDER_ID) return AX_ENGINE_STREAM_IDLE_TIMEOUT_MS
    if (isCliProviderID(providerID)) return CLI_STREAM_IDLE_TIMEOUT_MS
    return STREAM_IDLE_TIMEOUT_MS
  }

  export function streamMaxDurationMs(providerID?: string): number {
    const raw = process.env["AX_CODE_STREAM_MAX_DURATION_MS"]
    if (raw !== undefined && raw !== "") {
      const parsed = Number(raw)
      if (Number.isFinite(parsed) && parsed >= 0) return parsed
    }
    if (providerID === AX_ENGINE_PROVIDER_ID) return AX_ENGINE_STREAM_MAX_DURATION_MS
    if (isCliProviderID(providerID)) return CLI_STREAM_MAX_DURATION_MS
    return STREAM_MAX_DURATION_MS
  }

  export function attachStreamIdleWatchdog<T extends { fullStream: AsyncIterable<unknown> }>(
    output: T,
    options: {
      idleAbort: AbortController
      idleTimeoutMs: number
      maxDurationMs?: number
      providerID: string
      modelID: string
    },
  ): T {
    const maxDurationMs = options.maxDurationMs ?? 0
    if (options.idleTimeoutMs <= 0 && maxDurationMs <= 0) return output

    // Locally-executing tool calls observed on the stream: a `tool-call`
    // chunk has arrived but its `tool-result`/`tool-error` has not. While
    // this is > 0 the provider is not expected to send anything — the turn
    // is blocked on local work (a long shell command, a permission or
    // question prompt awaiting the user), so the watchdog re-arms instead
    // of aborting. Provider-executed tools stay on the provider's clock and
    // are not exempted. See .internal/bugs BUG-005.
    let executingToolCalls = 0
    let toolPauseStartedAt: number | undefined
    let maxDeadline = Date.now() + maxDurationMs
    const trackChunk = (chunk: unknown) => {
      if (!chunk || typeof chunk !== "object") return
      const value = chunk as { type?: unknown; providerExecuted?: unknown }
      if (value.providerExecuted === true) return
      if (value.type === "tool-call") {
        if (executingToolCalls === 0) toolPauseStartedAt = Date.now()
        executingToolCalls++
      } else if ((value.type === "tool-result" || value.type === "tool-error") && executingToolCalls > 0) {
        executingToolCalls--
        if (executingToolCalls === 0 && toolPauseStartedAt !== undefined) {
          maxDeadline += Date.now() - toolPauseStartedAt
          toolPauseStartedAt = undefined
        }
      }
    }

    // Manual race (see util/timeout.ts): once the watchdog fires, the still-
    // pending inner next() must not become an unhandled rejection when the
    // aborted fetch later rejects it.
    const raceWatchdog = <R>(op: Promise<R>): Promise<R> =>
      new Promise<R>((resolve, reject) => {
        let settled = false
        let idleTimer: ReturnType<typeof setTimeout> | undefined
        let durationTimer: ReturnType<typeof setTimeout> | undefined
        const clearTimers = () => {
          if (idleTimer) clearTimeout(idleTimer)
          if (durationTimer) clearTimeout(durationTimer)
        }
        const armIdle = () => {
          if (options.idleTimeoutMs <= 0) return
          idleTimer = setTimeout(() => {
            if (settled) return
            if (executingToolCalls > 0) {
              armIdle()
              return
            }
            settled = true
            options.idleAbort.abort()
            reject(
              new Error(
                `Model stream stalled — no data from ${options.providerID}/${options.modelID} for ${Math.round(options.idleTimeoutMs / 1000)}s; the request was aborted. This is usually a provider or network issue — retry, or raise AX_CODE_STREAM_IDLE_TIMEOUT_MS.`,
              ),
            )
          }, options.idleTimeoutMs)
          idleTimer.unref?.()
        }
        const armDuration = () => {
          if (maxDurationMs <= 0 || executingToolCalls > 0) return
          durationTimer = setTimeout(
            () => {
              if (settled) return
              settled = true
              options.idleAbort.abort()
              reject(
                new Error(
                  `Model stream exceeded the maximum active duration of ${Math.round(maxDurationMs / 1000)}s for ${options.providerID}/${options.modelID}; the request was aborted while it was still producing data. Retry with a smaller scope, switch models, or raise AX_CODE_STREAM_MAX_DURATION_MS.`,
                ),
              )
            },
            Math.max(0, maxDeadline - Date.now()),
          )
          durationTimer.unref?.()
        }
        armIdle()
        armDuration()
        op.then(
          (value) => {
            if (settled) return
            settled = true
            clearTimers()
            resolve(value)
          },
          (error) => {
            if (settled) return
            settled = true
            clearTimers()
            reject(error)
          },
        )
      })

    const fullStream: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        const inner = output.fullStream[Symbol.asyncIterator]()
        return {
          next: () =>
            raceWatchdog(inner.next()).then((result) => {
              const iteration = result as IteratorResult<unknown>
              if (!iteration.done) trackChunk(iteration.value)
              return result
            }),
          return: (value?: unknown) =>
            inner.return ? inner.return(value) : Promise.resolve({ done: true as const, value }),
          throw: (error?: unknown) => (inner.throw ? inner.throw(error) : Promise.reject(error)),
        }
      },
    }

    return new Proxy(output, {
      get(target, prop, receiver) {
        if (prop === "fullStream") return fullStream
        return Reflect.get(target, prop, receiver)
      },
    })
  }

  function attachSuperLongPacingReservation<T extends { fullStream: AsyncIterable<unknown> }>(
    output: T,
    reservation: SuperLongPacingReservation | undefined,
    signal: AbortSignal,
  ): T {
    if (!reservation) return output

    let started = false
    let released = false
    let releasePromise: Promise<void> | undefined
    const release = () => {
      if (released || started) return releasePromise ?? Promise.resolve()
      released = true
      releasePromise = releaseSuperLongPacingReservation(reservation)
      return releasePromise
    }
    const releaseOnAbort = () => {
      void release()
    }
    const markStarted = () => {
      started = true
      signal.removeEventListener("abort", releaseOnAbort)
    }
    if (signal.aborted) {
      void release()
    } else {
      signal.addEventListener("abort", releaseOnAbort, { once: true })
    }

    const cleanup = () => {
      signal.removeEventListener("abort", releaseOnAbort)
    }

    const fullStream: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        const inner = output.fullStream[Symbol.asyncIterator]()
        return {
          async next() {
            try {
              const result = await inner.next()
              if (result.done) {
                if (!started) await release()
                cleanup()
                return result
              }
              if (!started) markStarted()
              return result
            } catch (error) {
              if (!started) await release()
              cleanup()
              throw error
            }
          },
          async return(value?: unknown) {
            try {
              return (await inner.return?.(value)) ?? { done: true as const, value }
            } finally {
              if (!started) await release()
              cleanup()
            }
          },
          async throw(error?: unknown) {
            try {
              return (await inner.throw?.(error)) ?? Promise.reject(error)
            } finally {
              if (!started) await release()
              cleanup()
            }
          },
        }
      },
    }

    return new Proxy(output, {
      get(target, prop, receiver) {
        if (prop === "fullStream") return fullStream
        return Reflect.get(target, prop, receiver)
      },
    })
  }

  async function releaseSuperLongPacingReservation(reservation: SuperLongPacingReservation) {
    const state = superLongPacing.get(reservation.key)
    if (state) {
      const timestamps = [...state.timestamps]
      const index = timestamps.indexOf(reservation.timestamp)
      if (index !== -1) {
        timestamps.splice(index, 1)
        if (timestamps.length === 0) superLongPacing.delete(reservation.key)
        else setPacingEntry(reservation.key, { timestamps })
      }
    }
    if (!reservation.durable) return
    await SuperLongRuntime.releasePacingReservation({
      key: reservation.key,
      timestamp: reservation.timestamp,
      now: Date.now(),
    }).catch((error) => {
      log.warn("failed to release durable super-long pacing reservation", {
        key: reservation.key,
        timestamp: reservation.timestamp,
        error,
      })
    })
  }

  function systemMessage(
    content: string,
    mode?: PromptCachePolicy.PolicyMode,
    cacheControl?: { type: "ephemeral" },
  ): ModelMessage {
    if (mode !== "alibaba-explicit" || !cacheControl) {
      return { role: "system", content }
    }
    return {
      role: "system",
      content,
      providerOptions: {
        openaiCompatible: {
          cache_control: cacheControl,
        },
      },
    }
  }

  function superLongPacingKey(input: Pick<Parameters<typeof applySuperLongPacing>[0], "providerID" | "modelID">) {
    return providerModelKey(input)
  }

  function isSuperLongDurablePacingDisabled() {
    // Explicit false disables durable pacing; unset/unknown leaves it enabled.
    return Env.parseBoolean(process.env.AX_CODE_SUPER_LONG_DURABLE_PACING) === false
  }

  async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError")
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        signal.removeEventListener("abort", abortHandler)
        resolve()
      }, ms)
      const abortHandler = () => {
        clearTimeout(timeout)
        reject(new DOMException("Aborted", "AbortError"))
      }
      if (signal.aborted) {
        clearTimeout(timeout)
        reject(new DOMException("Aborted", "AbortError"))
        return
      }
      signal.addEventListener("abort", abortHandler, { once: true })
    })
  }

  // Cache Permission.disabled() across concurrent sessions. A small LRU
  // avoids the previous single-entry cache thrashing when rulesets interleave.
  const disabledCache = new Map<string, Set<string>>()
  const DISABLED_CACHE_MAX = 32

  /** Deterministic cache key: sorted tool keys + stable ruleset hash. */
  function disabledCacheKey(toolKeys: string[], ruleset: Permission.Ruleset): string {
    // Sort tool keys for stable ordering. Ruleset is serialized with a
    // recursive key-sorting replacer to guarantee deterministic output
    // regardless of property insertion order.
    const sortedKeys = toolKeys.slice().sort().join(",")
    const stableRuleset = JSON.stringify(ruleset, (_key, value) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, value[k]]),
        )
      }
      return value
    })
    return sortedKeys + "|" + stableRuleset
  }

  function cachedDisabled(toolKeys: string[], ruleset: Permission.Ruleset) {
    const key = disabledCacheKey(toolKeys, ruleset)
    const cached = disabledCache.get(key)
    if (cached) {
      disabledCache.delete(key)
      disabledCache.set(key, cached)
      return cached
    }
    const result = Permission.disabled(toolKeys, ruleset)
    disabledCache.set(key, result)
    if (disabledCache.size > DISABLED_CACHE_MAX) {
      const oldest = disabledCache.keys().next().value
      if (oldest !== undefined) disabledCache.delete(oldest)
    }
    return result
  }

  async function resolveTools(
    input: Pick<StreamInput, "tools" | "agent" | "permission" | "user">,
    cfg: Awaited<ReturnType<typeof Config.get>>,
  ) {
    const tools = { ...input.tools }
    const ruleset = Permission.merge(
      input.agent.permission,
      input.permission ?? [],
      permissionRulesetFromLegacyTools(input.user.tools),
    )
    const toolKeys = Object.keys(tools)
    const disabled = cachedDisabled(toolKeys, ruleset)
    for (const tool of toolKeys) {
      if (input.user.tools?.[tool] === false || disabled.has(tool)) {
        delete tools[tool]
      }
    }

    const isolation = resolvePromptIsolationPolicy({
      config: cfg.isolation,
      policy: input.user.isolation,
      directory: Instance.directory,
      worktree: Instance.worktree,
    })
    if (isolation.mode === "read-only") {
      for (const t of ["edit", "write", "apply_patch", "multiedit", "bash"]) delete tools[t]
    }
    if (!isolation.network) {
      for (const t of ["webfetch", "websearch", "codesearch"]) delete tools[t]
    }

    return tools
  }

  // Reset pacing state between tests; not called in production paths.
  export function clearPacingState() {
    superLongPacing.clear()
    superLongGraceElapsed.clear()
  }

  export function pacingKeyForTest(
    input: Pick<Parameters<typeof applySuperLongPacing>[0], "sessionID" | "providerID" | "modelID">,
  ) {
    return superLongPacingKey(input)
  }

  export function getPacingStateForTest(
    input: Pick<Parameters<typeof applySuperLongPacing>[0], "sessionID" | "providerID" | "modelID">,
  ) {
    return superLongPacing.get(superLongPacingKey(input))
  }

  export function setPacingStateForTest(
    input: Pick<Parameters<typeof applySuperLongPacing>[0], "sessionID" | "providerID" | "modelID">,
    state: SuperLongPolicy.PacingState,
  ) {
    setPacingEntry(superLongPacingKey(input), state)
  }

  export async function applySuperLongPacingForTest(input: Parameters<typeof applySuperLongPacing>[0]) {
    return applySuperLongPacing(input)
  }

  export function attachSuperLongPacingReservationForTest<T extends { fullStream: AsyncIterable<unknown> }>(
    output: T,
    reservation: SuperLongPacingReservation | undefined,
    signal: AbortSignal,
  ) {
    return attachSuperLongPacingReservation(output, reservation, signal)
  }

  // Append dynamic system text to the last user message. This is used for
  // providers whose chat template collapses all system turns into a single
  // leading system message, so that per-turn dynamic content (reasoning-policy
  // reminders, long-agent context packs) does not get merged into the cached
  // stable prefix. A new text part is appended when the message already uses
  // part arrays; string content is concatenated.
  function appendDynamicTextToLastUserMessage(messages: ModelMessage[], text: string): ModelMessage[] {
    let userIndex = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") {
        userIndex = i
        break
      }
    }
    if (userIndex === -1) {
      return [...messages, { role: "user", content: text }]
    }
    const msg = messages[userIndex]
    if (typeof msg.content === "string") {
      const updated = { ...msg, content: [msg.content, text].filter(Boolean).join("\n\n") } as ModelMessage
      return messages.map((m, i) => (i === userIndex ? updated : m))
    }
    if (Array.isArray(msg.content)) {
      const updated = { ...msg, content: [...msg.content, { type: "text" as const, text }] } as ModelMessage
      return messages.map((m, i) => (i === userIndex ? updated : m))
    }
    return messages
  }

  // Check if messages contain any tool-call content
  // Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
  export function hasToolCalls(messages: ModelMessage[]): boolean {
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue
      for (const part of msg.content) {
        if (part.type === "tool-call" || part.type === "tool-result") return true
      }
    }
    return false
  }

  // Extract the last user text message as task description for context packing.
  export function extractLastUserTask(messages: ModelMessage[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role !== "user") continue
      if (typeof msg.content === "string") return msg.content.slice(0, 500)
      if (Array.isArray(msg.content)) {
        for (const part of msg.content as Array<{ type: string; text?: string }>) {
          if (part.type === "text" && part.text) return part.text.slice(0, 500)
        }
      }
    }
    return undefined
  }

  // Extract file paths accessed by file-touching tools from assistant messages.
  export function extractTouchedFiles(messages: ModelMessage[]): Array<{ path: string; summary: string }> {
    const FILE_TOOLS = new Set(["read", "edit", "write", "multiedit", "apply_patch"])
    const paths = new Map<string, string>()
    for (const msg of messages) {
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue
      for (const part of msg.content as Array<{ type: string; toolName?: string; input?: Record<string, unknown> }>) {
        if (part.type !== "tool-call" || !FILE_TOOLS.has(part.toolName ?? "")) continue
        const inp = part.input as Record<string, unknown> | undefined
        const filePath = (inp?.file_path ?? inp?.path) as string | undefined
        if (filePath && typeof filePath === "string") {
          paths.set(filePath, `accessed by ${part.toolName}`)
        }
      }
    }
    return [...paths.entries()].slice(0, 20).map(([path, summary]) => ({ path, summary }))
  }
}
