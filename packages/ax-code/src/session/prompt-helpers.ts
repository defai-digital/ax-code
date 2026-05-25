import { Instance } from "../project/instance"
import { MessageID, PartID, SessionID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
export { commandTemplateText } from "./prompt-command-template"
export { commandModel, commandUser, lastModel } from "./prompt-command-selection"
export { commandParts } from "./prompt-command-parts"
export { resolvePromptParts } from "./prompt-reference-parts"
export { appendShellOutputChunk, shellArgs, shellOutputMetadata, type ShellOutputState } from "./prompt-shell-runtime"
export { agentInfo, modelInfo } from "./prompt-agent-model-info"
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

type AssistantPath = MessageV2.Assistant["path"]
type AssistantTokens = MessageV2.Assistant["tokens"]

export function textPart(input: {
  messageID: MessageID
  sessionID: SessionID
  text: string
  synthetic?: boolean
  time?: MessageV2.TextPart["time"]
}): MessageV2.TextPart {
  return {
    id: PartID.ascending(),
    messageID: input.messageID,
    sessionID: input.sessionID,
    type: "text",
    text: input.text,
    ...(input.synthetic === undefined ? {} : { synthetic: input.synthetic }),
    ...(input.time === undefined ? {} : { time: input.time }),
  }
}

export function syntheticTextPart(input: {
  messageID: MessageID
  sessionID: SessionID
  text: string
}): MessageV2.TextPart {
  return textPart({ ...input, synthetic: true })
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

export function sessionAssistantPath(input?: { directory?: string; worktree?: string }): AssistantPath {
  return {
    cwd: input?.directory ?? Instance.directory,
    root: input?.worktree ?? Instance.worktree,
  }
}

export function zeroTokenUsage(input?: { total?: number }): AssistantTokens {
  const tokens = {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { read: 0, write: 0 },
  }
  if (input?.total === undefined) return tokens
  return {
    total: input.total,
    ...tokens,
  }
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
