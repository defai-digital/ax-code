import type { Tool } from "ai"
import type { ForceTextReason } from "./prompt-autonomous-decisions"

export const LOCAL_SYNTHESIS_TOOL_REJECTION =
  "Local synthesis is answer-only. No tool ran. Use the existing evidence to answer now; disclose any unverified gaps."

export function canPreserveLocalSynthesisTools(input: {
  providerID: string
  forceTextOnly: boolean
  forceReason?: ForceTextReason
  hasEvidence: boolean
  isLastStep: boolean
  omitTools: boolean
  structured: boolean
  supportsTools: boolean
}) {
  return (
    input.providerID === "ax-engine" &&
    input.forceTextOnly &&
    input.forceReason === "ax_engine_read_only" &&
    input.hasEvidence &&
    !input.isLastStep &&
    !input.omitTools &&
    !input.structured &&
    input.supportsTools
  )
}

/** Preserve wire definitions, never the callable capabilities, during final synthesis. */
export function guardLocalSynthesisTools(tools: Record<string, Tool>): Record<string, Tool> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, item]) => {
      // Provider-defined tools can execute remotely without a local callback.
      if (item.type === "provider") throw new Error("Provider-defined tools cannot enter local synthesis")
      return [
        name,
        {
          ...item,
          onInputStart: undefined,
          onInputDelta: undefined,
          onInputAvailable: undefined,
          // No approval callback or result conversion may invoke the original
          // tool either. The replacement can only reject; it grants no action.
          needsApproval: false,
          toModelOutput: undefined,
          execute: async () => {
            throw new Error(LOCAL_SYNTHESIS_TOOL_REJECTION)
          },
        },
      ]
    }),
  )
}
