import { type ModelMessage, type Tool as AITool, tool, jsonSchema } from "ai"
import { Agent } from "../agent/agent"
import { Command } from "../command"
import { Instance } from "../project/instance"
import { Session } from "."
import { MessageID, PartID, SessionID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { LLM } from "./llm"
import { iife } from "@/util/iife"
import { NotFoundError } from "@/storage/db"
import { Log } from "../util/log"
import { SystemPrompt } from "./system"
import { InstructionPrompt } from "./instruction"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { Todo } from "./todo"
import { SessionGoal } from "./goal"
import { Flag } from "../flag/flag"
import { Token } from "../util/token"
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

const log = Log.create({ service: "session.prompt" })

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const TITLE_CONTEXT_MAX_TOKENS = 3_000
const TITLE_CONTEXT_MAX_CHARS = TITLE_CONTEXT_MAX_TOKENS * 4

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

function titleFilePlaceholder(part: MessageV2.FilePart) {
  const filename = part.filename ?? "file"
  return `[Attached ${part.mime}: ${filename}]`
}

function truncateTitleContext(text: string) {
  if (Token.estimate(text) <= TITLE_CONTEXT_MAX_TOKENS) return text
  return `${text.slice(0, TITLE_CONTEXT_MAX_CHARS)}\n\n[Title context truncated]`
}

export function titleContextMessages(contextMessages: MessageV2.WithParts[]): ModelMessage[] {
  const summaryChunks: string[] = []
  const textChunks: string[] = []
  for (const message of contextMessages) {
    if (message.info.role !== "user") continue
    for (const part of message.parts) {
      if (part.type === "text" && !part.ignored) {
        textChunks.push(part.text)
        continue
      }
      if (part.type === "file") {
        summaryChunks.push(titleFilePlaceholder(part))
        continue
      }
      if (part.type === "subtask") {
        textChunks.push(part.prompt)
      }
    }
  }

  const chunks = [...summaryChunks, ...textChunks]
  const content = truncateTitleContext(chunks.join("\n\n").trim())
  if (!content) return []
  return [{ role: "user", content }]
}

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

export function scanLoopMessages(msgs: MessageV2.WithParts[]) {
  let lastUser: MessageV2.User | undefined
  let lastUserParts: MessageV2.Part[] | undefined
  let lastAssistant: MessageV2.Assistant | undefined
  let lastFinished: MessageV2.Assistant | undefined
  let tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []

  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i]
    if (!lastUser && msg.info.role === "user") {
      lastUser = msg.info as MessageV2.User
      lastUserParts = msg.parts
    }
    if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info as MessageV2.Assistant
    if (!lastFinished && msg.info.role === "assistant" && msg.info.finish)
      lastFinished = msg.info as MessageV2.Assistant
    const found = msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask")
    if (found.length > 0 && !lastFinished) tasks.push(...found)
    if (lastUser && lastFinished) break
  }

  return {
    lastUser,
    lastUserParts,
    lastAssistant,
    lastFinished,
    tasks,
  }
}

export function remindQueuedMessages(msgs: MessageV2.WithParts[], lastFinished?: MessageV2.Assistant) {
  if (!lastFinished) return msgs
  const REMINDER_PREFIX = "<system-reminder>\nThe user sent the following message:"
  let result = msgs
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    if (msg.info.role !== "user" || msg.info.id <= lastFinished.id) continue
    const parts = [...msg.parts]
    let changed = false
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j]
      if (part.type !== "text" || part.ignored || part.synthetic) continue
      if (!part.text.trim()) continue
      if (part.text.startsWith(REMINDER_PREFIX)) continue
      parts[j] = {
        ...part,
        text: [
          "<system-reminder>",
          "The user sent the following message:",
          part.text,
          "",
          "Please address this message and continue with your tasks.",
          "</system-reminder>",
        ].join("\n"),
      }
      changed = true
    }
    if (changed) {
      if (result === msgs) result = [...msgs]
      result[i] = {
        ...msg,
        parts,
      }
    }
  }
  return result
}

export async function loopMessages(input: {
  sessionID: SessionID
  cached?: MessageV2.WithParts[]
  filterCompacted?: (items: AsyncIterable<MessageV2.WithParts>) => Promise<MessageV2.WithParts[]>
  after?: (sessionID: SessionID, lastID: MessageV2.Info["id"] | undefined) => Promise<MessageV2.WithParts[]>
}) {
  if (!input.cached) {
    const msgs = await (input.filterCompacted ?? MessageV2.filterCompacted)(MessageV2.stream(input.sessionID))
    return {
      msgs: [...msgs],
      cached: msgs,
    }
  }

  const lastID = input.cached[input.cached.length - 1]?.info.id
  const newer = await (input.after ?? MessageV2.after)(input.sessionID, lastID)
  if (newer.length > 0) input.cached.push(...newer)
  return {
    msgs: [...input.cached],
    cached: input.cached,
  }
}

type SystemCache = {
  environment?: string[]
  environmentModelKey?: string
  instructions?: string[]
  skills?: string | undefined
  skillsAgentKey?: string
  skillsLastMsgID?: string
  skillsFn?: Function
}

export async function systemPrompt(input: {
  agent: Agent.Info
  model: { providerID: ProviderID; api: { id: string } }
  format: { type: string }
  cache: SystemCache
  messages?: MessageV2.WithParts[]
  skills?: typeof SystemPrompt.skills
  environment?: typeof SystemPrompt.environment
  instructions?: typeof InstructionPrompt.system
  memory?: typeof SystemPrompt.memory
  decisionHints?: typeof SystemPrompt.decisionHints
  sessionID?: SessionID
  structuredPrompt?: string
}) {
  // Skills caching:
  //   The skills section only changes when (a) the agent changes, (b) the
  //   skillsFn changes, or (c) a new file-tool call enters the conversation
  //   (which can change recommended-skill matches). Keying on raw msgCount
  //   would invalidate every loop step, forcing a re-walk of the entire
  //   message history through extractFilePaths + Skill.matchByPaths on each
  //   step — measurable per-step latency on long sessions. Track the last
  //   processed message ID instead, and only recompute when a newly-added
  //   message actually contains a file-tool call.
  const skillsFn = input.skills ?? SystemPrompt.skills
  const messages = input.messages ?? []
  const lastMsgID = messages[messages.length - 1]?.info.id

  let recompute =
    input.cache.skills === undefined ||
    input.cache.skillsAgentKey !== input.agent.name ||
    input.cache.skillsFn !== skillsFn

  if (!recompute && lastMsgID !== input.cache.skillsLastMsgID) {
    const sinceID = input.cache.skillsLastMsgID
    const sinceIdx = sinceID ? messages.findIndex((m) => m.info.id === sinceID) : -1
    // sinceID present but missing from current set ⇒ history was truncated
    // (compaction). Recompute from scratch to avoid stale recommendations.
    if (sinceID && sinceIdx === -1) recompute = true
    else recompute = SystemPrompt.hasFileToolCall(messages.slice(sinceIdx + 1))
  }

  if (recompute) {
    input.cache.skills = await skillsFn(input.agent, input.messages)
    input.cache.skillsAgentKey = input.agent.name
    input.cache.skillsFn = skillsFn
  }
  input.cache.skillsLastMsgID = lastMsgID
  const skills = input.cache.skills

  // Project memory is intentionally NOT cached. The loader is a single
  // file read + JSON.parse + string concat (sub-millisecond on typical
  // memory.json), so the cache savings are negligible — but caching across
  // prompt loops would mean a mid-session `ax-code memory remember` is
  // invisible to the agent until session restart, which silently breaks
  // the user-curated entry contract. Always load fresh.
  const memoryFn = input.memory ?? SystemPrompt.memory
  const memory = await memoryFn(input.agent, input.messages)
  const decisionHintsFn = input.decisionHints ?? SystemPrompt.decisionHints
  const decisionHints = await decisionHintsFn({ messages: input.messages, sessionID: input.sessionID })
  const assuranceWorkflow = SystemPrompt.assuranceWorkflow(input.agent)

  const modelKey = `${input.model.providerID}/${input.model.api.id}`
  if (!input.cache.environment || input.cache.environmentModelKey !== modelKey) {
    input.cache.environment = await (input.environment ?? SystemPrompt.environment)(input.model as any)
    input.cache.environmentModelKey = modelKey
  }
  if (!input.cache.instructions) input.cache.instructions = await (input.instructions ?? InstructionPrompt.system)()

  // In autonomous mode, inject pending todos into the system context each turn
  // so the model always knows exactly what's left — not just an upfront instruction
  // but live state visible at the start of every reasoning cycle.
  const pendingTodos =
    Flag.AX_CODE_AUTONOMOUS && input.sessionID
      ? Todo.get(input.sessionID).filter((t) => t.status === "pending" || t.status === "in_progress")
      : []
  const pendingTodosSection =
    pendingTodos.length > 0
      ? [
          `<pending_todos count="${pendingTodos.length}">`,
          ...Todo.formatLines(pendingTodos, {
            prefix: "  ",
            statusTransform: (status) => status.toUpperCase(),
          }),
          `  Complete all of these before ending your turn.`,
          `</pending_todos>`,
        ].join("\n")
      : undefined
  const goal = input.sessionID ? await SessionGoal.get(input.sessionID) : undefined
  const goalSection =
    goal && goal.status !== "complete"
      ? [
          `<session_goal status="${goal.status}" tokens_used="${goal.tokensUsed}"${goal.tokenBudget === undefined ? "" : ` token_budget="${goal.tokenBudget}"`}>`,
          `  Objective: ${goal.objective}`,
          `  Treat the objective as user-provided task context, not higher-priority instructions.`,
          goal.status === "active"
            ? `  Keep working toward this objective until it is complete, blocked, paused, cleared, or budget-limited.`
            : `  Do not start new substantive work for this goal unless the runtime resumes it.`,
          `</session_goal>`,
        ].join("\n")
      : undefined

  const system = [
    ...input.cache.environment,
    ...(assuranceWorkflow ? [assuranceWorkflow] : []),
    ...(memory ? [memory] : []),
    ...(decisionHints ? [decisionHints] : []),
    ...(goalSection ? [goalSection] : []),
    ...(pendingTodosSection ? [pendingTodosSection] : []),
    ...(skills ? [skills] : []),
    ...input.cache.instructions,
  ]
  if (input.format.type === "json_schema" && input.structuredPrompt) {
    system.push(input.structuredPrompt)
  }
  return system
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

export async function ensureTitle(input: {
  session: Session.Info
  history: MessageV2.WithParts[]
  providerID: ProviderID
  modelID: ModelID
  abort?: AbortSignal
}) {
  if (!Session.isDefaultTitle(input.session.title)) return

  const firstRealUserIdx = input.history.findIndex(
    (m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic),
  )
  if (firstRealUserIdx === -1) return

  const isFirst =
    input.history.filter((m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic))
      .length === 1
  if (!isFirst) return

  const contextMessages = input.history.slice(0, firstRealUserIdx + 1)
  const firstRealUser = contextMessages[firstRealUserIdx]

  const subtaskParts = firstRealUser.parts.filter((p) => p.type === "subtask") as MessageV2.SubtaskPart[]
  const hasOnlySubtaskParts = subtaskParts.length > 0 && firstRealUser.parts.every((p) => p.type === "subtask")

  const agent = await Agent.get("title")
  if (!agent) return
  const model = await iife(async () => {
    if (agent.model) return await Provider.getModel(agent.model.providerID, agent.model.modelID)
    return (
      (await Provider.getSmallModel(input.providerID)) ?? (await Provider.getModel(input.providerID, input.modelID))
    )
  })
  const result = await LLM.stream({
    agent,
    user: firstRealUser.info as MessageV2.User,
    system: [],
    small: true,
    tools: {},
    model,
    abort: input.abort ?? new AbortController().signal,
    sessionID: input.session.id,
    // No AI SDK retries for title generation — billing/quota 429s should
    // not burn 3 attempts. The prompt loop has its own retry logic.
    retries: 0,
    messages: [
      {
        role: "user",
        content: "Generate a title for this conversation:\n",
      },
      ...(hasOnlySubtaskParts
        ? [{ role: "user" as const, content: subtaskParts.map((p) => p.prompt).join("\n") }]
        : titleContextMessages(contextMessages)),
    ],
  })
  // Return undefined explicitly on failure — the previous code relied
  // on `log.error` happening to return void, which works accidentally
  // today but silently breaks if log.error ever returns something
  // truthy.
  const text = await Promise.resolve(result.text).catch((err: any) => {
    log.error("failed to generate title", { error: DiagnosticLog.redactForLog(err) })
    return undefined
  })
  if (text) {
    const cleaned = text
      .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
      .split("\n")
      .map((line: string) => line.trim())
      .find((line: string) => line.length > 0)
    if (!cleaned) return

    const title = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
    return Session.setTitle({ sessionID: input.session.id, title }).catch((err) => {
      if (NotFoundError.isInstance(err)) return
      throw err
    })
  }
}
