import { AgentControl } from "./agent-control"

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
    if (input.requestedDepth === "standard") return standard("explicit_request")
    if (!input.model.capabilities?.reasoning) return standard()
    if (input.userVariant) return standard()

    if (
      hasExplicitReasoning(input.model.options) ||
      hasExplicitReasoning(input.agent.options) ||
      hasExplicitReasoning(input.providerOptions)
    )
      return standard()

    if (input.requestedDepth) {
      return decisionForDepth(input, input.requestedDepth, "explicit_request") ?? standard()
    }
    if ((input.failureCount ?? 0) >= 2) {
      return decisionForDepth(input, "deep", "repeated_failure") ?? standard()
    }
    if (input.uncertainty === "high") {
      return decisionForDepth(input, "deep", "high_uncertainty") ?? standard()
    }
    if (input.blastRadius === "high") {
      return decisionForDepth(input, "deep", "high_blast_radius") ?? standard()
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

    if (!input.autonomous && input.agent.name !== "plan" && !(planningSignal && riskSignal)) return standard()

    return (
      decisionForDepth(
        input,
        "deep",
        input.autonomous ? "autonomous_mode" : input.agent.name === "plan" ? "plan_mode" : "planning_risk_signal",
        objectiveText,
      ) ?? standard()
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
      "thinkingConfig" in options
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
    if (Object.keys(options).length === 0) return undefined
    return options
  }

  function decisionForDepth(
    input: Input,
    depth: Depth,
    reason: Reason,
    objectiveText = objective(input.messages),
  ): Decision | undefined {
    if (depth === "fast") return fast(reason)
    if (depth === "standard") return standard(reason)

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

  function selectVariant(
    variants: ReasoningPolicyModel["variants"],
    depth: Extract<Depth, "deep" | "xdeep">,
  ): { depth: Extract<Depth, "deep" | "xdeep">; options: Record<string, unknown> } | undefined {
    if (depth === "xdeep") {
      const max = usableVariant(variants?.xdeep) ?? usableVariant(variants?.max)
      if (max) return { depth: "xdeep", options: max }
    }
    const deep = usableVariant(variants?.deep) ?? usableVariant(variants?.high) ?? usableVariant(variants?.medium)
    if (deep) return { depth: "deep", options: deep }
    return undefined
  }

  function fast(reason?: Reason): Decision {
    return {
      depth: "fast",
      reason,
      options: {},
      checkpoint: false,
    }
  }

  function standard(reason?: Reason): Decision {
    return {
      depth: "standard",
      reason,
      options: {},
      checkpoint: false,
    }
  }
}
