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
import { Permission } from "@/permission"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { withTimeout } from "@/util/timeout"
import { Recorder } from "@/replay/recorder"
import { AgentControl } from "@/control-plane/agent-control"
import { AgentControlEvents } from "@/control-plane/agent-control-events"
import { isNonEmptyRecord } from "@/util/record"
import { SuperLongPolicy } from "./super-long-policy"
import { SuperLongRuntime } from "./super-long-runtime"
import { longAgentProfileForModel } from "@/provider/agent-optimization-profile"
import { PromptCachePolicy } from "@/provider/prompt-cache-policy"
import { LongAgentContextPacker } from "@/context/long-agent-packer"
import { permissionRulesetFromLegacyTools } from "./prompt-permission"
import { resolvePromptIsolationPolicy } from "./prompt-runtime-policy"

import { ReasoningPolicy } from "@/control-plane/reasoning-policy"

export namespace LLM {
  const log = Log.create({ service: "llm" })
  const superLongPacing = new Map<string, SuperLongPolicy.PacingState>()

  export type StreamInput = {
    user: MessageV2.User
    sessionID: string
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
  }

  export type StreamOutput = StreamTextResult<ToolSet, any>

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
    // 90s timeout: getLanguage() may call getSDK() → BunProc.install() which
    // has its own 60s timeout. A 30s outer timeout would kill a legitimate
    // first-run SDK install on a slow network.
    const [language, cfg, provider] = await withTimeout(
      Promise.all([
        Provider.getLanguage(input.model),
        input.config ?? Config.get(),
        Provider.getProvider(input.model.providerID),
      ]),
      90_000,
      `LLM setup timed out for ${input.model.providerID}/${input.model.id} — provider may be unreachable`,
    )

    const system: string[] = []
    const joined = [
      // use agent prompt otherwise provider prompt
      ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
      // any custom prompt passed into this call
      ...input.system,
      // any custom prompt from last user message
      ...(input.user.system ? [input.user.system] : []),
    ]
      .filter((x) => x)
      .join("\n")
    if (joined) system.push(joined)
    const reasoningPolicyDecision = ReasoningPolicy.decide({
      small: input.small,
      autonomous: Flag.AX_CODE_AUTONOMOUS,
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
    const reasoningPolicyReminder = ReasoningPolicy.systemReminder(reasoningPolicyDecision)
    if (reasoningPolicyReminder) system.push(reasoningPolicyReminder)

    const longAgentProfile = longAgentProfileForModel(input.model.id)
    const autonomousEnabled = Flag.AX_CODE_AUTONOMOUS
    const superLongEnabled =
      !input.small &&
      autonomousEnabled &&
      SuperLongPolicy.runtimeState({
        modelID: input.model.id,
        config: SuperLongPolicy.fromConfig(cfg.super_long),
      }).enabled
    // The verification-loop reminder is provider-agnostic supervision text —
    // it must fire for every Super-Long run, not just models whose long-agent
    // profile enables the extra request shaping below. Gating it on the
    // profile left Super-Long with no observable behavior on non-Qwen models.
    if (superLongEnabled) {
      system.push(
        "You are operating in Super-Long mode. Before declaring any task complete: run available tests or verification commands, confirm the build is clean, and surface any repeated failure patterns explicitly rather than retrying silently.",
      )
    }

    const header = system[0]
    const prePluginLength = system.length
    await Plugin.trigger(
      "experimental.chat.system.transform",
      { sessionID: input.sessionID, model: input.model },
      { system },
    )
    // Rejoin to maintain 2-part structure for caching if header unchanged.
    // Only apply this normalization if the plugin didn't modify the array
    // (same length) — otherwise we'd overwrite plugin additions.
    if (system.length > 2 && system.length === prePluginLength && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
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
        system.push(["## Long-Agent Context Pack", renderedContext].join("\n"))
      }
      l.info("long-agent context pack", {
        debugSummary: packResult.debugSummary,
        touchedCount: touchedFiles.length,
      })
    }

    // Phase 3: classify finalized system blocks and apply provider-specific
    // message annotations. All system blocks are stable (provider instructions,
    // rules, reminders, long-agent context pack).
    let systemMessages = system.map((content) => systemMessage(content))
    if (superLongEnabled && longAgentProfile.promptCacheEligible) {
      const cacheBlocks = PromptCachePolicy.buildBlocks(
        system.map((content, i) => ({ label: i === 0 ? "system" : "stable-rules", content })),
      )
      const cacheResult = PromptCachePolicy.render(cacheBlocks, input.model.providerID)
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
    }

    const messages = [...systemMessages, ...input.messages]

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

    const maxOutputTokens = ProviderTransform.maxOutputTokens(input.model)

    const tools = await resolveTools(input, cfg)
    const pacingReservation = await applySuperLongPacing({
      enabled: superLongEnabled,
      providerID: input.model.providerID,
      modelID: input.model.id,
      sessionID: input.sessionID,
      small: input.small,
      abort: input.abort,
      baseURL: typeof provider.options?.baseURL === "string" ? provider.options.baseURL : undefined,
    })

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
    let output: StreamOutput
    try {
      output = streamText({
        // @ts-expect-error
        maxDuration: 300_000,
        onError(error) {
          l.error("stream error", {
            error: DiagnosticLog.redactForLog(error),
          })
        },
        async experimental_repairToolCall(failed) {
          const lower = failed.toolCall.toolName.toLowerCase()
          if (lower !== failed.toolCall.toolName && tools[lower]) {
            l.info("repairing tool call", {
              tool: failed.toolCall.toolName,
              repaired: lower,
            })
            return {
              ...failed.toolCall,
              toolName: lower,
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
        providerOptions: ProviderTransform.providerOptions(input.model, paramsOptions),
        activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
        tools,
        toolChoice: input.toolChoice,
        maxOutputTokens,
        abortSignal: input.abort,
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
    return attachSuperLongPacingReservation(output, pacingReservation, input.abort)
  }

  export type SuperLongPacingReservation = {
    key: string
    timestamp: number
    durable: boolean
  }

  async function applySuperLongPacing(input: {
    enabled: boolean
    providerID: string
    modelID: string
    sessionID: string
    small?: boolean
    abort: AbortSignal
    baseURL?: string
    policy?: SuperLongPolicy.PacingPolicy
    now?: () => number
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  }): Promise<SuperLongPacingReservation | undefined> {
    if (!input.enabled || input.small) return
    const key = superLongPacingKey(input)
    const policy = input.policy ?? SuperLongPolicy.providerPacing(input.providerID, { baseURL: input.baseURL })
    if (!policy) return
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
            superLongPacing.set(key, reservedState)
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
      superLongPacing.set(input.key, { timestamps: decision.timestamps })
      return { decision }
    }

    const next = SuperLongPolicy.recordRequest({ now: input.now, state, policy: input.policy })
    superLongPacing.set(input.key, next)
    return { decision, state: next }
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
        else superLongPacing.set(reservation.key, { timestamps })
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
    const value = (process.env.AX_CODE_SUPER_LONG_DURABLE_PACING ?? "").trim().toLowerCase()
    return value === "0" || value === "false"
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

  // Cache Permission.disabled() results — the ruleset rarely changes within a session
  let _disabledCache: { key: string; toolKeys: string; result: Set<string> } | undefined

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
    const toolKeysStr = toolKeys.join(",")
    const key = JSON.stringify(ruleset)
    const disabled =
      _disabledCache?.key === key && _disabledCache.toolKeys === toolKeysStr
        ? _disabledCache.result
        : (() => {
            const r = Permission.disabled(toolKeys, ruleset)
            _disabledCache = { key, toolKeys: toolKeysStr, result: r }
            return r
          })()
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
    superLongPacing.set(superLongPacingKey(input), state)
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
