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
    if (explicitUserVariant(input)) return emptyStandard()

    if (
      hasExplicitReasoning(input.model.options) ||
      hasExplicitReasoning(input.agent.options) ||
      hasExplicitReasoning(input.providerOptions)
    )
      return emptyStandard()

    // Apply Auto/escalation when the model reasons natively OR publishes effort
    // variants (CLI providers report reasoning=false but still accept --effort).
    if (!canTuneEffort(input.model)) return emptyStandard()

    if (input.requestedDepth) {
      return decisionForDepth(input, input.requestedDepth, "explicit_request") ?? auto(input)
    }
    if ((input.failureCount ?? 0) >= 2) {
      return decisionForDepth(input, "deep", "repeated_failure") ?? auto(input)
    }
    if (input.uncertainty === "high") {
      return decisionForDepth(input, "deep", "high_uncertainty") ?? auto(input)
    }
    if (input.blastRadius === "high") {
      return decisionForDepth(input, "deep", "high_blast_radius") ?? auto(input)
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

    return (
      decisionForDepth(
        input,
        "deep",
        input.autonomous ? "autonomous_mode" : input.agent.name === "plan" ? "plan_mode" : "planning_risk_signal",
        objectiveText,
      ) ?? auto(input)
    )
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

  function canTuneEffort(model: ReasoningPolicyModel): boolean {
    if (model.capabilities?.reasoning) return true
    // CLI / gateway models may publish effort variants without reasoning=true.
    return Boolean(selectAutoBaseline(model.variants) || selectDeepOptions(model.variants))
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
    return usableVariant(variants?.deep) ?? usableVariant(variants?.high) ?? usableVariant(variants?.medium)
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
