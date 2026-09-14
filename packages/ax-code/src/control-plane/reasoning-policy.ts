import { AgentControl } from "./agent-control"
import { isNonEmptyRecord } from "../util/record"

type ReasoningPolicyModel = {
  capabilities?: {
    reasoning?: boolean
  }
  options?: Record<string, unknown>
  variants?: Record<string, Record<string, unknown> | undefined>
}

type ReasoningPolicyAgent = {
  name?: string
  options?: Record<string, unknown>
}

type ReasoningPolicyMessage = {
  role?: string
  content?: unknown
}

export namespace ReasoningPolicy {
  export type Depth = AgentControl.ReasoningDepth
  export type Reason =
    | "small_request"
    | "explicit_request"
    | "auto_baseline"
    | "plan_mode"
    | "autonomous_mode"
    | "planning_risk_signal"
    | "repeated_failure"
    | "high_uncertainty"
    | "high_blast_radius"
  export type Decision = {
    depth: Depth
    reason?: Reason
    objective?: string
    options: Record<string, unknown>
    checkpoint: boolean
    requestedDepth?: Depth
    unappliedReason?: "explicit_override" | "unsupported_effort"
  }

  export type Input = {
    small?: boolean
    autonomous?: boolean
    requestedDepth?: Depth
    failureCount?: number
    uncertainty?: "low" | "medium" | "high"
    blastRadius?: "low" | "medium" | "high"
    userVariant?: string
    model: ReasoningPolicyModel
    agent: ReasoningPolicyAgent
    providerOptions?: Record<string, unknown>
    messages: ReasoningPolicyMessage[]
  }

  export function options(input: Input): Record<string, unknown> {
    return decide(input).options
  }

  export function decide(input: Input): Decision {
    if (input.small) return fast("small_request")
    if (input.requestedDepth === "fast") return fast("explicit_request")
    // Explicit standard depth keeps empty options (caller/user already chose depth).
    if (input.requestedDepth === "standard") return emptyStandard("explicit_request")

    // User-selected effort is applied later from model.variants[userVariant].
    // Sentinel values ("auto", bare "default") mean Auto, not a wire override.
    if (explicitUserVariant(input))
      return { ...emptyStandard(), requestedDepth: input.requestedDepth, unappliedReason: "explicit_override" }

    if (
      hasExplicitReasoning(input.model.options) ||
      hasExplicitReasoning(input.agent.options) ||
      hasExplicitReasoning(input.providerOptions)
    )
      return { ...emptyStandard(), requestedDepth: input.requestedDepth, unappliedReason: "explicit_override" }

    if (input.requestedDepth) {
      return resolveDepth(input, input.requestedDepth, "explicit_request")
    }
    if ((input.failureCount ?? 0) >= 2) {
      return resolveDepth(input, "deep", "repeated_failure")
    }
    if (input.uncertainty === "high") {
      return resolveDepth(input, "deep", "high_uncertainty")
    }
    if (input.blastRadius === "high") {
      return resolveDepth(input, "deep", "high_blast_radius")
    }

    const objectiveText = objective(input.messages)
    const taskText = objectiveText.toLowerCase()
    const planningSignal =
      input.agent.name === "plan" ||
      /\b(plan|planning|prd|adr|architecture|architectural|design|tradeoff|trade-off|strategy)\b/.test(taskText) ||
      /(計畫|規劃|架構|設計|取捨|策略)/.test(taskText)
    const riskSignal =
      /\b(autonomous|reasoning|think|thinking|deep|complex|review|refactor|migration|performance|bottleneck|debug|root cause|regression|multi-?file|cross-?cutting|best practices)\b/.test(
        taskText,
      ) || /(自主|推理|深度|複雜|審查|重構|遷移|效能|瓶頸|除錯|根因|回歸|跨檔案|最佳實務)/.test(taskText)

    if (!input.autonomous && input.agent.name !== "plan" && !(planningSignal && riskSignal)) {
      return auto(input)
    }

    return resolveDepth(
      input,
      "deep",
      input.autonomous ? "autonomous_mode" : input.agent.name === "plan" ? "plan_mode" : "planning_risk_signal",
      objectiveText,
    )
  }

  /** Only structured execution results count; tool/user prose cannot trigger recovery. */
  export function failureCount(messages: ReasoningPolicyMessage[]): number {
    let failures = 0
    let remaining = 128
    for (let i = messages.length - 1; i >= Math.max(0, messages.length - 128); i--) {
      const message = messages[i]
      if (message.role === "user") break
      if (message.role !== "tool" || !Array.isArray(message.content)) continue
      for (let j = message.content.length - 1; j >= 0 && remaining-- > 0; j--) {
        const part = message.content[j]
        if (!part || part.type !== "tool-result") continue
        const type = part.output?.type
        if (type === "error-text" || type === "error-json") failures++
        else return failures
      }
      if (remaining <= 0) break
    }
    return failures
  }

  /** Policy selection only; plugins and the SDK can still transform wire options. */
  export function diagnostics(decision: Decision) {
    return {
      selectedDepth: decision.depth,
      requestedDepth: decision.requestedDepth,
      reason: decision.reason,
      unappliedReason: decision.unappliedReason,
    }
  }

  function resolveDepth(input: Input, depth: Depth, reason: Reason, objectiveText?: string): Decision {
    const selected = decisionForDepth(input, depth, reason, objectiveText)
    return {
      ...(selected ?? auto(input, reason)),
      requestedDepth: depth,
      ...(!selected || selected.depth !== depth ? { unappliedReason: "unsupported_effort" as const } : {}),
    }
  }

  export function objective(messages: ReasoningPolicyMessage[]): string {
    return latestUserText(messages).trim()
  }

  export function systemReminder(decision: Decision): string | undefined {
    if ((decision.depth !== "deep" && decision.depth !== "xdeep") || !decision.checkpoint) return undefined
    return [
      `<reasoning_policy depth="${decision.depth}" reason="${decision.reason}">`,
      "Use the extra reasoning budget for a concise decision checkpoint before tool-heavy implementation.",
      "Checkpoint format: objective, evidence, assumptions, chosen plan, risk, validation.",
      "Do not expose private chain-of-thought; summarize decisions and evidence only.",
      "</reasoning_policy>",
    ].join("\n")
  }

  function hasExplicitReasoning(value: unknown) {
    if (Array.isArray(value)) return value.some(hasExplicitReasoning)
    if (!value || typeof value !== "object") return false
    const options = value as Record<string, unknown>
    if (
      "reasoning" in options ||
      "reasoningEffort" in options ||
      "reasoning_effort" in options ||
      "thinking" in options ||
      "thinkingConfig" in options ||
      // Anthropic current models use top-level `effort`; Alibaba uses enable_thinking.
      "effort" in options ||
      "enable_thinking" in options ||
      "thinking_budget" in options
    )
      return true
    return Object.values(options).some(hasExplicitReasoning)
  }

  function latestUserText(messages: ReasoningPolicyMessage[]) {
    const message = [...messages].reverse().find((item) => item.role === "user")
    return textFrom(message?.content)
  }

  function textFrom(value: unknown): string {
    if (typeof value === "string") return value
    if (Array.isArray(value)) return value.map(textFrom).filter(Boolean).join("\n")
    if (!value || typeof value !== "object") return ""
    const part = value as Record<string, unknown>
    if (typeof part.text === "string") return part.text
    if (typeof part.content === "string") return part.content
    return ""
  }

  function usableVariant(candidate: Record<string, unknown> | undefined) {
    if (!candidate || candidate.disabled === true) return undefined
    const { disabled: _disabled, ...options } = candidate
    if (!isNonEmptyRecord(options)) return undefined
    return options
  }

  /**
   * True when the user picked a real effort override (not Auto).
   * "auto" is never a provider wire level we synthesize; bare "default" is only
   * an override when the model actually publishes a `default` variant.
   */
  function explicitUserVariant(input: Input): string | undefined {
    const variant = input.userVariant
    if (variant === undefined || variant === "") return undefined
    const key = variant.toLowerCase()
    if (key === "auto") return undefined
    if (key === "default" && !usableVariant(input.model.variants?.default)) return undefined
    return variant
  }

  function decisionForDepth(
    input: Input,
    depth: Depth,
    reason: Reason,
    objectiveText = objective(input.messages),
  ): Decision | undefined {
    if (depth === "fast") return fast(reason)
    if (depth === "standard") return auto(input, reason)

    const selected = selectVariant(input.model.variants, depth)
    if (!selected) return undefined
    return {
      depth: selected.depth,
      reason,
      objective: objectiveText || undefined,
      options: selected.options,
      checkpoint: true,
    }
  }

  function selectDeepOptions(variants: ReasoningPolicyModel["variants"]): Record<string, unknown> | undefined {
    return usableVariant(variants?.deep) ?? usableVariant(variants?.high)
  }

  function selectVariant(
    variants: ReasoningPolicyModel["variants"],
    depth: Extract<Depth, "deep" | "xdeep">,
  ): { depth: Extract<Depth, "deep" | "xdeep">; options: Record<string, unknown> } | undefined {
    if (depth === "xdeep") {
      const max = usableVariant(variants?.xdeep) ?? usableVariant(variants?.max) ?? usableVariant(variants?.xhigh)
      if (max) return { depth: "xdeep", options: max }
    }
    const deep = selectDeepOptions(variants)
    if (deep) return { depth: "deep", options: deep }
    return undefined
  }

  /**
   * Balanced baseline for Auto (no user effort override).
   * Prefer medium/default so reasoning-capable models actually enable thinking
   * instead of shipping bare provider defaults that often disable it.
   * CLI providers map the same keys onto native --effort flags.
   */
  function selectAutoBaseline(variants: ReasoningPolicyModel["variants"]): Record<string, unknown> | undefined {
    return usableVariant(variants?.medium) ?? usableVariant(variants?.default)
  }

  function fast(reason?: Reason): Decision {
    return {
      depth: "fast",
      reason,
      options: {},
      checkpoint: false,
    }
  }

  /** Empty options — used when caller/user already owns the reasoning shape. */
  function emptyStandard(reason?: Reason): Decision {
    return {
      depth: "standard",
      reason,
      options: {},
      checkpoint: false,
    }
  }

  /** Auto mode: apply a balanced variant when the model exposes one. */
  function auto(input: Input, reason?: Reason): Decision {
    const options = selectAutoBaseline(input.model.variants) ?? {}
    return {
      depth: "standard",
      reason: reason ?? (isNonEmptyRecord(options) ? "auto_baseline" : undefined),
      options,
      checkpoint: false,
    }
  }
}
