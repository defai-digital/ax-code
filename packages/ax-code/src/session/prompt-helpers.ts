import { MessageV2 } from "./message-v2"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
export { commandTemplateText } from "./prompt-command-template"
export { commandModel, commandUser, lastModel } from "./prompt-command-selection"
export { commandParts } from "./prompt-command-parts"
export { resolvePromptParts } from "./prompt-reference-parts"
export { appendShellOutputChunk, shellArgs, shellOutputMetadata, type ShellOutputState } from "./prompt-shell-runtime"
export { agentInfo, modelInfo } from "./prompt-agent-model-info"
export { sessionAssistantPath, syntheticTextPart, textPart, zeroTokenUsage } from "./prompt-message-builders"
export { commandSetup } from "./prompt-command-setup"
export { ensureTitle, titleContextMessages } from "./prompt-title"
export { systemPrompt } from "./prompt-system"
export { loopMessages, remindQueuedMessages, scanLoopMessages } from "./prompt-loop-messages"
export { createStructuredOutputTool } from "./prompt-structured-output"
export {
  assistantLoopExitDecision,
  assistantRespondedAfterUser,
  consecutiveErrorDecision,
  pendingCompactionDecision,
  processorLoopDecision,
  providerFallbackLookupDecision,
  providerFallbackSwitchState,
  shouldScheduleUsageCompaction,
} from "./prompt-loop-decisions"

type AttachmentLineRange = {
  start: number
  end?: number
}

type GoalArgumentDecision =
  | { action: "view" | "pause" | "resume" | "clear" }
  | {
      action: "create"
      objective: string
      tokenBudget?: number
    }

export function readToolCallText(args: { filePath?: string; offset?: number; limit?: number }) {
  return `Called the Read tool with the following input: ${JSON.stringify(args)}`
}

export function attachmentLineRange(input: { start: string | null; end: string | null }): AttachmentLineRange | undefined {
  if (input.start == null) return undefined
  const parsedStart = Number(input.start)
  if (!Number.isInteger(parsedStart) || parsedStart < 0) return undefined

  const parsedEnd = input.end != null && input.end !== "" ? Number(input.end) : undefined
  const end =
    parsedEnd !== undefined && Number.isInteger(parsedEnd) && parsedEnd >= parsedStart ? parsedEnd : undefined
  return { start: parsedStart, end }
}

export function parseGoalArguments(raw: string): GoalArgumentDecision {
  const text = raw.trim()
  if (!text) return { action: "view" }
  const lower = text.toLowerCase()
  if (lower === "pause") return { action: "pause" }
  if (lower === "resume") return { action: "resume" }
  if (lower === "clear") return { action: "clear" }

  const budgetMatch = /^--(?:token-)?budget\s+(\d+)\s+([\s\S]+)$/.exec(text)
  if (budgetMatch) {
    return {
      action: "create",
      tokenBudget: Number(budgetMatch[1]),
      objective: budgetMatch[2].trim(),
    }
  }
  return { action: "create", objective: text }
}

/**
 * Find a fallback model from a different provider when the current one fails.
 * Skips the failed provider and returns the best model from the next available one.
 */
export async function findFallbackModel(
  failedProviderID: ProviderID,
): Promise<{ providerID: ProviderID; modelID: ModelID } | undefined> {
  const providers = await Provider.list()
  for (const [id, provider] of Object.entries(providers)) {
    if (id === failedProviderID) continue
    const models = Provider.sort(Object.values(provider.models))
    if (models.length > 0) {
      return { providerID: ProviderID.make(id), modelID: models[0].id }
    }
  }
  return undefined
}
