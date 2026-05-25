import path from "path"
import os from "os"
import fs from "fs/promises"
import { type ModelMessage, type Tool as AITool, tool, jsonSchema } from "ai"
import { pathToFileURL } from "url"
import { Agent } from "../agent/agent"
import { Command } from "../command"
import { Instance } from "../project/instance"
import { ConfigMarkdown } from "../config/markdown"
import { Session } from "."
import { MessageID, PartID, SessionID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { LLM } from "./llm"
import { iife } from "@/util/iife"
import { NotFoundError } from "@/storage/db"
import { Log } from "../util/log"
import { NamedError } from "@ax-code/util/error"
import { Process } from "@/util/process"
import { Shell } from "@/shell/shell"
import { SystemPrompt } from "./system"
import { InstructionPrompt } from "./instruction"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { Filesystem } from "@/util/filesystem"
import { Todo } from "./todo"
import { SessionGoal } from "./goal"
import { Flag } from "../flag/flag"
import { Token } from "../util/token"
import type { SessionProcessor } from "./processor"
import type { SessionCompaction } from "./compaction"
import { formatDecisionCount, modelTurnFinished } from "./prompt-autonomous-decisions"

function publishAgentInfoError(input: {
  sessionID: SessionID
  message: string
  report?: (sessionID: SessionID, error: Record<string, unknown>) => unknown
}) {
  const error = new NamedError.Unknown({ message: input.message }).toObject()
  if (input.report) {
    input.report(input.sessionID, error)
    return error
  }
  Session.publishError({ sessionID: input.sessionID, error })
  return error
}

const log = Log.create({ service: "session.prompt" })

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g
const bashRegex = /!`([^`]+)`/g
const TITLE_CONTEXT_MAX_TOKENS = 3_000
const TITLE_CONTEXT_MAX_CHARS = TITLE_CONTEXT_MAX_TOKENS * 4

type AgentLike = {
  hidden?: boolean
  name: string
}

type AgentInfo = NonNullable<Awaited<ReturnType<typeof Agent.get>>>
type ModelInfo = Awaited<ReturnType<typeof Provider.getModel>>

type PendingCompactionDecision =
  | { type: "break"; reason: "completed" | "error" }
  | { type: "retry"; delayMs: number }
  | { type: "continue" }

type AssistantLoopExitDecision =
  | { action: "continue" }
  | { action: "complete" }
  | { action: "complete_unknown_finish"; logMessage: string }

type AssistantTurnCursor = {
  lastUserID: string
  lastAssistant?: Pick<MessageV2.Assistant, "id" | "finish">
}

type RespondedAssistantTurnCursor = AssistantTurnCursor & {
  lastAssistant: Pick<MessageV2.Assistant, "id" | "finish"> & { finish: string }
}

type ConsecutiveErrorDecision =
  | { action: "continue" }
  | {
      action: "stop"
      reason: "error"
      message: string
    }

type ProviderFallbackLookupDecision =
  | { action: "skip" }
  | {
      action: "lookup"
      errorMessage: string | undefined
    }

type ProviderModelIdentity = {
  providerID: ProviderID
  modelID: ModelID
}

type ProviderFallbackSwitchState = {
  from: string
  to: string
  reason: string
  message: string
  nextConsecutiveErrors: number
}

type GoalArgumentDecision =
  | { action: "view" | "pause" | "resume" | "clear" }
  | {
      action: "create"
      objective: string
      tokenBudget?: number
    }

export type ShellOutputState = {
  output: string
  outputBytes: number
  outputTruncated: boolean
}

type AssistantPath = MessageV2.Assistant["path"]
type AssistantTokens = MessageV2.Assistant["tokens"]

type ProcessorCompactionTriggerReason = Extract<
  SessionCompaction.TriggerReason,
  "provider_usage" | "context_overflow_error"
>

type ProcessorLoopDecision =
  | { action: "continue" }
  | {
      action: "stop"
      reason: "completed" | "error"
    }
  | {
      action: "compact"
      overflow: boolean
      triggerReason: ProcessorCompactionTriggerReason
    }

// Cap consecutive busy retries before giving up. 40 × 250ms ≈ 10s, which
// matches the previous practical ceiling but turns an unbounded livelock
// (compaction stuck in-flight) into an explicit error path the loop can
// surface to the user.
const PENDING_COMPACTION_BUSY_RETRY_LIMIT = 40

function retryLimitReached(attempts: number | undefined, limit: number) {
  return !((attempts ?? 0) < limit)
}

export function pendingCompactionDecision(input: {
  result: Awaited<ReturnType<typeof SessionCompaction.process>>
  overflow?: boolean
  busyRetries?: number
}): PendingCompactionDecision {
  if (input.result === "stop") {
    return { type: "break", reason: input.overflow ? "error" : "completed" }
  }
  if (input.result === "busy") {
    if (retryLimitReached(input.busyRetries, PENDING_COMPACTION_BUSY_RETRY_LIMIT)) {
      return { type: "break", reason: "error" }
    }
    return { type: "retry", delayMs: 250 }
  }
  return { type: "continue" }
}

export function shouldScheduleUsageCompaction(input: {
  lastFinished?: Pick<MessageV2.Assistant, "summary" | "tokens">
  overflow: boolean
}) {
  return input.lastFinished !== undefined && input.lastFinished.summary !== true && input.overflow
}

export function consecutiveErrorDecision(input: {
  consecutiveErrors: number
  maxConsecutiveErrors: number
  step: number
}): ConsecutiveErrorDecision {
  if (!retryLimitReached(input.consecutiveErrors, input.maxConsecutiveErrors)) return { action: "continue" }

  return {
    action: "stop",
    reason: "error",
    message:
      `Agent encountered ${formatDecisionCount(input.consecutiveErrors)} consecutive errors at step ${input.step}. ` +
      `Stopping to prevent retry loop. Try rephrasing your request or breaking it into smaller tasks.`,
  }
}

const PROVIDER_FALLBACK_STATUS_CODES = new Set([401, 402, 403, 429])

function hasRepeatedErrors(value: number, threshold: number) {
  return Number.isFinite(value) && value >= threshold
}

function reduceFallbackConsecutiveErrors(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value / 2)
}

function fallbackErrorReason(message: string | undefined) {
  const reason = message?.trim()
  return reason ? reason : "unknown error"
}

export function providerFallbackLookupDecision(input: {
  consecutiveErrors: number
  error: unknown
}): ProviderFallbackLookupDecision {
  if (!hasRepeatedErrors(input.consecutiveErrors, 2)) return { action: "skip" }
  if (!input.error || typeof input.error !== "object") return { action: "skip" }

  const error = input.error as { name?: unknown; data?: { statusCode?: unknown; message?: unknown } }
  const statusCode = error.data?.statusCode
  if (error.name !== "APIError" || typeof statusCode !== "number" || !PROVIDER_FALLBACK_STATUS_CODES.has(statusCode)) {
    return { action: "skip" }
  }

  return {
    action: "lookup",
    errorMessage: typeof error.data?.message === "string" ? error.data.message : undefined,
  }
}

export function providerFallbackSwitchState(input: {
  current: ProviderModelIdentity
  fallback: ProviderModelIdentity
  errorMessage: string | undefined
  consecutiveErrors: number
}): ProviderFallbackSwitchState {
  const from = `${input.current.providerID}/${input.current.modelID}`
  const to = `${input.fallback.providerID}/${input.fallback.modelID}`
  const reason = fallbackErrorReason(input.errorMessage)
  return {
    from,
    to,
    reason,
    message: `Provider ${input.current.providerID} failed: ${reason}. Switching to ${to}.`,
    nextConsecutiveErrors: reduceFallbackConsecutiveErrors(input.consecutiveErrors),
  }
}

export function processorLoopDecision(input: {
  result: SessionProcessor.Result
  messageFinish: string | undefined
  hasError: boolean
}): ProcessorLoopDecision {
  if (input.result === "stop") {
    return { action: "stop", reason: input.hasError ? "error" : "completed" }
  }
  if (input.result !== "compact") return { action: "continue" }
  return {
    action: "compact",
    overflow: !input.messageFinish,
    triggerReason: input.messageFinish ? "provider_usage" : "context_overflow_error",
  }
}

export function assistantRespondedAfterUser(input: AssistantTurnCursor): input is RespondedAssistantTurnCursor {
  return Boolean(input.lastAssistant?.finish && input.lastUserID < input.lastAssistant.id)
}

export function assistantLoopExitDecision(input: AssistantTurnCursor & {
  hasPendingSubtask: boolean
}): AssistantLoopExitDecision {
  if (!assistantRespondedAfterUser(input)) return { action: "continue" }

  const finish = input.lastAssistant.finish
  if (modelTurnFinished(finish)) {
    return { action: "complete" }
  }

  if (finish === "unknown" && !input.hasPendingSubtask) {
    return {
      action: "complete_unknown_finish",
      logMessage: "model returned unknown finish with no actionable output",
    }
  }

  return { action: "continue" }
}

function titleFilePlaceholder(part: MessageV2.FilePart) {
  const filename = part.filename ?? "file"
  return `[Attached ${part.mime}: ${filename}]`
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined
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

export function appendShellOutputChunk(
  state: ShellOutputState,
  chunk: Buffer | string,
  hardCap: number,
): ShellOutputState {
  const text = typeof chunk === "string" ? chunk : chunk.toString()
  if (!text || state.outputTruncated) return state

  const chunkBytes = Buffer.byteLength(text, "utf-8")
  if (state.outputBytes + chunkBytes <= hardCap) {
    return {
      ...state,
      output: state.output + text,
      outputBytes: state.outputBytes + chunkBytes,
    }
  }

  let end = text.length
  const remaining = hardCap - state.outputBytes
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf-8") > remaining) {
    end--
  }

  let output = state.output
  let outputBytes = state.outputBytes
  if (end > 0) {
    const slice = text.slice(0, end)
    output += slice
    outputBytes += Buffer.byteLength(slice, "utf-8")
  }

  return {
    output: output + "\n\n[output truncated at 10MB]",
    outputBytes,
    outputTruncated: true,
  }
}

export function shellOutputMetadata(state: ShellOutputState) {
  return {
    output: state.output,
    description: "",
    outputTruncated: state.outputTruncated,
  }
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

function shellKey(shell: string, platform = process.platform) {
  const name = platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)
  return name.toLowerCase()
}

export function shellArgs(shell: string, command: string, platform = process.platform) {
  const name = shellKey(shell, platform)
  const args: Record<string, string[]> = {
    nu: ["-c", command],
    fish: ["-c", command],
    zsh: [
      "-c",
      "-l",
      `
            [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
            [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
            eval ${JSON.stringify(command)}
          `,
    ],
    bash: [
      "-c",
      "-l",
      `
            shopt -s expand_aliases
            [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
            eval ${JSON.stringify(command)}
          `,
    ],
    cmd: ["/c", command],
    powershell: ["-NoProfile", "-Command", command],
    pwsh: ["-NoProfile", "-Command", command],
    "": ["-c", command],
  }

  return args[name] ?? args[""]
}

function commandArgs(input: string) {
  const raw = input.match(argsRegex) ?? []
  return raw.map((item) => item.replace(quoteTrimRegex, ""))
}

function commandTemplate(template: string, input: string) {
  const args = commandArgs(input)
  const placeholders = template.match(placeholderRegex) ?? []
  const hasArgumentsPlaceholder = template.includes("$ARGUMENTS")
  let last = 0
  for (const item of placeholders) {
    const value = Number(item.slice(1))
    if (value > last) last = value
  }

  const withArgs = template.replaceAll(placeholderRegex, (_, index) => {
    const position = Number(index)
    const arg = position - 1
    // Guard both ends of the range. The upper bound catches missing
    // trailing args; the lower bound catches `$0` which would produce
    // `args[-1]` = undefined and stringify to the literal "undefined"
    // in the rendered template. See BUG-72.
    if (arg < 0 || arg >= args.length) return ""
    if (!hasArgumentsPlaceholder && position === last) return args.slice(arg).join(" ")
    return args[arg]
  })

  if (placeholders.length === 0 && !hasArgumentsPlaceholder && input.trim()) {
    return withArgs + "\n\n" + input
  }

  if (!hasArgumentsPlaceholder) return withArgs

  const remaining = placeholders.length > 0 ? args.slice(last).join(" ") : input
  return withArgs.replaceAll("$ARGUMENTS", remaining)
}

export async function commandTemplateText(input: {
  template: string
  arguments: string
  run?: (cmd: string) => Promise<string>
}) {
  let text = commandTemplate(input.template, input.arguments)
  const matches = ConfigMarkdown.shell(text)
  if (matches.length === 0) return text.trim()

  const run =
    input.run ??
    (async (cmd: string) => {
      const out = await Process.text([cmd], { shell: Shell.preferred(), nothrow: true })
      return out.text
    })

  const settled = await Promise.allSettled(matches.map(async ([, cmd]) => run(cmd)))
  const results = settled.map((r) => (r.status === "fulfilled" ? r.value : "<shell command failed>"))
  let index = 0
  text = text.replace(bashRegex, () => results[index++])
  return text.trim()
}

export async function commandModel(input: {
  command?: { model?: string; agent?: string }
  model?: string
  sessionID: SessionID
}) {
  if (input.command?.model) {
    return Provider.parseModel(input.command.model)
  }
  if (input.command?.agent) {
    const agent = await Agent.get(input.command.agent)
    if (agent?.model) {
      return agent.model
    }
  }
  if (input.model) return Provider.parseModel(input.model)
  return lastModel(input.sessionID)
}

export async function commandUser(input: {
  subtask: boolean
  inputAgent?: string
  inputModel?: string
  agentName: string
  taskModel: { providerID: ProviderID; modelID: ModelID }
  sessionID: SessionID
  defaultAgent?: () => Promise<string>
  parseModel?: (model: string) => { providerID: ProviderID; modelID: ModelID }
  last?: (sessionID: SessionID) => Promise<{ providerID: ProviderID; modelID: ModelID }>
}) {
  if (!input.subtask) {
    return {
      agent: input.agentName,
      model: input.taskModel,
    }
  }

  return {
    agent: input.inputAgent ?? (await (input.defaultAgent ?? Agent.defaultAgent)()),
    model: input.inputModel
      ? (input.parseModel ?? Provider.parseModel)(input.inputModel)
      : await (input.last ?? lastModel)(input.sessionID),
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

export async function agentInfo<T extends AgentLike = AgentInfo>(input: {
  sessionID: SessionID
  name: string
  get?: (name: string) => Promise<T | undefined>
  list?: () => Promise<T[]>
  report?: (sessionID: SessionID, error: Record<string, unknown>) => unknown
}) {
  const agent = await (input.get ?? Agent.get)(input.name)
  if (agent) return agent

  const available = await (input.list ?? Agent.list)().then((items) =>
    items.filter((item) => Agent.resolveTier(item) !== "internal").map((item) => item.name),
  )
  const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
  const errorMessage = `Agent not found: "${input.name}".${hint}`
  publishAgentInfoError({
    sessionID: input.sessionID,
    message: errorMessage,
    report: input.report,
  })
  throw new NamedError.Unknown({ message: errorMessage })
}

export async function modelInfo<T = ModelInfo>(input: {
  sessionID: SessionID
  providerID: ProviderID
  modelID: ModelID
  get?: (providerID: ProviderID, modelID: ModelID) => Promise<T>
  report?: (sessionID: SessionID, error: Record<string, unknown>) => unknown
}) {
  try {
    return await (input.get ?? Provider.getModel)(input.providerID, input.modelID)
  } catch (error) {
    if (Provider.ModelNotFoundError.isInstance(error)) {
      const { providerID, modelID, suggestions } = error.data
      const hint = suggestions?.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""
      publishAgentInfoError({
        sessionID: input.sessionID,
        message: `Model not found: ${providerID}/${modelID}.${hint}`,
        report: input.report,
      })
    }
    throw error
  }
}

export async function commandParts(input: {
  agent: { mode?: string; name: string }
  command: { subtask?: boolean; description?: string }
  name: string
  model: { providerID: ProviderID; modelID: ModelID }
  template: string
  parts?: any[]
}) {
  const base = await resolvePromptParts(input.template)
  const hasExtra = [...base, ...(input.parts ?? [])].some((item) => item.type !== "text")
  const subtask =
    !hasExtra &&
    ((input.agent.mode === "subagent" && input.command.subtask !== false) || input.command.subtask === true)
  if (!subtask) return { subtask, parts: [...base, ...(input.parts ?? [])] }

  return {
    subtask,
    parts: [
      {
        type: "subtask" as const,
        agent: input.agent.name,
        description: input.command.description ?? "",
        command: input.name,
        model: {
          providerID: input.model.providerID,
          modelID: input.model.modelID,
        },
        prompt: base.find((item) => item.type === "text")?.text ?? "",
      },
    ],
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

export async function resolvePromptParts(template: string): Promise<any[]> {
  const parts: any[] = [
    {
      type: "text",
      text: template,
    },
  ]
  const files = ConfigMarkdown.files(template)
  const seen = new Set<string>()
  await Promise.all(
    files.map(async (match) => {
      const name = match[1]
      if (seen.has(name)) return
      seen.add(name)
      const filepath = name.startsWith("~/")
        ? path.resolve(os.homedir(), name.slice(2))
        : path.resolve(Instance.worktree, name)
      const checkedPath = await fs.realpath(filepath).catch((error) => {
        const code = errorCode(error)
        if (code !== "ENOENT") {
          log.warn("failed to resolve included file path", { filepath, error })
        }
        return undefined
      })
      if (!checkedPath) {
        const agent = await Agent.get(name)
        if (agent) {
          parts.push({
            type: "agent",
            name: agent.name,
          })
        }
        return
      }

      if (name.startsWith("~/") && !Filesystem.contains(os.homedir(), checkedPath)) {
        return
      }

      if (!name.startsWith("~/") && !Filesystem.contains(Instance.worktree, checkedPath)) {
        return
      }

      const stats = await fs.stat(checkedPath).catch(() => undefined)
      if (!stats) return

      if (stats.isDirectory()) {
        parts.push({
          type: "file",
          url: pathToFileURL(checkedPath).href,
          filename: name,
          mime: "application/x-directory",
        })
        return
      }

      parts.push({
        type: "file",
        url: pathToFileURL(checkedPath).href,
        filename: name,
        mime: "text/plain",
      })
    }),
  )
  return parts
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

export async function lastModel(sessionID: SessionID) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
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
