import { Installation } from "@/installation"
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
import { Isolation } from "@/isolation"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { withTimeout } from "@/util/timeout"
import { Recorder } from "@/replay/recorder"
import { AgentControl } from "@/control-plane/agent-control"
import { AgentControlEvents } from "@/control-plane/agent-control-events"

import { ReasoningPolicy } from "@/control-plane/reasoning-policy"

export namespace LLM {
  const log = Log.create({ service: "llm" })
  export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX

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
      autonomous: process.env["AX_CODE_AUTONOMOUS"] === "true",
      userVariant: input.user.variant,
      model: input.model,
      agent: input.agent,
      providerOptions: provider?.options,
      messages: input.messages,
    })
    if (reasoningPolicyDecision.checkpoint) {
      Recorder.emit(AgentControlEvents.reasoningSelected({
        sessionID: input.sessionID,
        depth: reasoningPolicyDecision.depth,
        reason: reasoningPolicyDecision.reason ?? "policy_selected",
        policyVersion: "v4-bridge",
        checkpoint: reasoningPolicyDecision.checkpoint,
      }))
    }
    if (input.agent.name === "plan") {
      Recorder.emit(AgentControlEvents.phaseChanged({
        sessionID: input.sessionID,
        previousPhase: "assess",
        phase: "plan",
        reason: "plan_mode",
        deterministic: false,
      }))
      Recorder.emit(AgentControlEvents.planCreated({
        sessionID: input.sessionID,
        deterministic: false,
        plan: AgentControl.createShadowPlan({
          id: `plan_${input.sessionID}`,
          objective: ReasoningPolicy.objective(input.messages) || reasoningPolicyDecision.objective || "Plan mode session",
          ownerAgent: input.agent.name,
          reason: "plan_mode",
        }),
      }))
    }
    const reasoningPolicyReminder = ReasoningPolicy.systemReminder(reasoningPolicyDecision)
    if (reasoningPolicyReminder) system.push(reasoningPolicyReminder)

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
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider?.options ?? {},
        })
    const options: Record<string, any> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
      mergeDeep(reasoningPolicyDecision.options),
    )
    const messages = [
      ...system.map(
        (x): ModelMessage => ({
          role: "system",
          content: x,
        }),
      ),
      ...input.messages,
    ]

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

    if (isLiteLLMProxy && Object.keys(tools).length === 0 && hasToolCalls(input.messages)) {
      tools["_noop"] = tool({
        description:
          "Placeholder for LiteLLM/Anthropic proxy compatibility - required when message history contains tool calls but no active tools are needed",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }

    return streamText({
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
      providerOptions: ProviderTransform.providerOptions(input.model, params.options),
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      tools,
      toolChoice: input.toolChoice,
      maxOutputTokens,
      abortSignal: input.abort,
      headers: {
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
      },
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
  }

  // Cache Permission.disabled() results — the ruleset rarely changes within a session
  let _disabledCache: { key: string; toolKeys: string; result: Set<string> } | undefined

  async function resolveTools(
    input: Pick<StreamInput, "tools" | "agent" | "permission" | "user">,
    cfg: Awaited<ReturnType<typeof Config.get>>,
  ) {
    const tools = { ...input.tools }
    const ruleset = Permission.merge(input.agent.permission, input.permission ?? [])
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

    const isolation = Isolation.resolve(cfg.isolation, Instance.directory, Instance.worktree)
    if (isolation.mode === "read-only") {
      for (const t of ["edit", "write", "apply_patch", "multiedit", "bash"]) delete tools[t]
    }
    if (!isolation.network) {
      for (const t of ["webfetch", "websearch", "codesearch"]) delete tools[t]
    }

    return tools
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
}
