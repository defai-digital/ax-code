import { finiteNumber } from "@/util/number"

export type EventTokenCounts = { input: number; output: number; reasoning: number }

/**
 * Token counts carried by an `llm.response` or `step.finish` replay event.
 * Non-object payloads and non-finite fields count as zero, so a malformed or
 * partial event never poisons a total.
 */
export function eventTokens(value: unknown): EventTokenCounts {
  if (!value || typeof value !== "object") return { input: 0, output: 0, reasoning: 0 }
  const tokens = value as { input?: unknown; output?: unknown; reasoning?: unknown }
  return {
    input: finiteNumber(tokens.input),
    output: finiteNumber(tokens.output),
    reasoning: finiteNumber(tokens.reasoning),
  }
}
