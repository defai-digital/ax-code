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
  export type Depth = "standard" | "deep"
  export type Reason = "plan_mode" | "autonomous_mode" | "planning_risk_signal"
  export type Decision = {
    depth: Depth
    reason?: Reason
    options: Record<string, unknown>
    checkpoint: boolean
  }

  export type Input = {
    small?: boolean
    autonomous?: boolean
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
    if (input.small) return standard()
    if (!input.model.capabilities?.reasoning) return standard()
    if (input.userVariant) return standard()

    if (
      hasExplicitReasoning(input.model.options) ||
      hasExplicitReasoning(input.agent.options) ||
      hasExplicitReasoning(input.providerOptions)
    )
      return standard()

    const taskText = latestUserText(input.messages).toLowerCase()
    const planningSignal =
      input.agent.name === "plan" ||
      /\b(plan|planning|prd|adr|architecture|architectural|design|tradeoff|trade-off|strategy)\b/.test(taskText)
    const riskSignal =
      /\b(autonomous|reasoning|think|thinking|deep|complex|review|refactor|migration|performance|bottleneck|debug|root cause|regression|multi-?file|cross-?cutting|best practices)\b/.test(
          taskText,
      )

    if (!input.autonomous && input.agent.name !== "plan" && !(planningSignal && riskSignal)) return standard()

    const options = usableVariant(input.model.variants?.high) ?? usableVariant(input.model.variants?.medium)
    if (!options) return standard()

    return {
      depth: "deep",
      reason: input.autonomous ? "autonomous_mode" : input.agent.name === "plan" ? "plan_mode" : "planning_risk_signal",
      options,
      checkpoint: true,
    }
  }

  export function systemReminder(decision: Decision): string | undefined {
    if (decision.depth !== "deep" || !decision.checkpoint) return undefined
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
    return (
      "reasoning" in options ||
      "reasoningEffort" in options ||
      "reasoning_effort" in options ||
      "thinking" in options ||
      "thinkingConfig" in options
    )
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
    return options
  }

  function standard(): Decision {
    return {
      depth: "standard",
      options: {},
      checkpoint: false,
    }
  }
}
