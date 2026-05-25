import { type Tool as AITool, tool, jsonSchema } from "ai"
import { Agent } from "../agent/agent"
import { Command } from "../command"
import { Instance } from "../project/instance"
import { MessageID, PartID, SessionID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { commandTemplateText } from "./prompt-command-template"
import { commandModel, commandUser } from "./prompt-command-selection"
import { commandParts } from "./prompt-command-parts"
import { agentInfo, modelInfo } from "./prompt-agent-model-info"
export { commandTemplateText } from "./prompt-command-template"
export { commandModel, commandUser, lastModel } from "./prompt-command-selection"
export { commandParts } from "./prompt-command-parts"
export { resolvePromptParts } from "./prompt-reference-parts"
export { appendShellOutputChunk, shellArgs, shellOutputMetadata, type ShellOutputState } from "./prompt-shell-runtime"
export { agentInfo, modelInfo } from "./prompt-agent-model-info"
export { ensureTitle, titleContextMessages } from "./prompt-title"
export { systemPrompt } from "./prompt-system"
export { loopMessages, remindQueuedMessages, scanLoopMessages } from "./prompt-loop-messages"
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

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

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

export async function commandSetup(input: {
  command: {
    agent?: string
    model?: string
    template: string | Promise<string>
    description?: string
    subtask?: boolean
  }
  name: string
  arguments: string
  sessionID: SessionID
  agent?: string
  model?: string
  parts?: unknown[]
}) {
  const agentName = input.command.agent ?? input.agent ?? (await Agent.defaultAgent())
  const template = await commandTemplateText({
    template: await input.command.template,
    arguments: input.arguments,
  })

  const taskModel = await commandModel({
    command: input.command,
    model: input.model,
    sessionID: input.sessionID,
  })
  await modelInfo({
    sessionID: input.sessionID,
    providerID: taskModel.providerID,
    modelID: taskModel.modelID,
  })

  const agent = await agentInfo({
    sessionID: input.sessionID,
    name: agentName,
  })

  const result = await commandParts({
    agent,
    command: input.command,
    name: input.name,
    model: taskModel,
    template,
    parts: input.parts,
  })

  const user = await commandUser({
    subtask: result.subtask,
    inputAgent: input.agent,
    inputModel: input.model,
    agentName,
    taskModel,
    sessionID: input.sessionID,
  })

  return {
    agent,
    agentName,
    model: taskModel,
    parts: result.parts,
    subtask: result.subtask,
    template,
    user,
  }
}

export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  const { $schema, ...toolSchema } = input.schema

  return tool({
    id: "StructuredOutput" as any,
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as any),
    async execute(args) {
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput(result) {
      return {
        type: "text",
        value: result.output,
      }
    },
  })
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
