import path from "path"
import os from "os"
import fs from "fs/promises"
import { type Tool as AITool, tool, jsonSchema } from "ai"
import { pathToFileURL } from "url"
import { Agent } from "../agent/agent"
import { Command } from "../command"
import { Instance } from "../project/instance"
import { ConfigMarkdown } from "../config/markdown"
import { Session } from "."
import { SessionID } from "./schema"
import { MessageV2 } from "./message-v2"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { LLM } from "./llm"
import { iife } from "@/util/iife"
import { NotFoundError } from "@/storage/db"
import { Log } from "../util/log"
import { NamedError } from "@ax-code/util/error"
import { Bus } from "../bus"
import { Process } from "@/util/process"
import { Shell } from "@/shell/shell"
import { SystemPrompt } from "./system"
import { InstructionPrompt } from "./instruction"

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

type AgentLike = {
  hidden?: boolean
  name: string
}

type AgentInfo = NonNullable<Awaited<ReturnType<typeof Agent.get>>>
type ModelInfo = Awaited<ReturnType<typeof Provider.getModel>>

export function shellKey(shell: string, platform = process.platform) {
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

export function commandArgs(input: string) {
  const raw = input.match(argsRegex) ?? []
  return raw.map((item) => item.replace(quoteTrimRegex, ""))
}

export function commandTemplate(template: string, input: string) {
  const args = commandArgs(input)
  const placeholders = template.match(placeholderRegex) ?? []
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
    if (position === last) return args.slice(arg).join(" ")
    return args[arg]
  })

  if (placeholders.length === 0 && !template.includes("$ARGUMENTS") && input.trim()) {
    return withArgs + "\n\n" + input
  }

  return withArgs.replaceAll("$ARGUMENTS", input)
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
  command: { model?: string; agent?: string }
  model?: string
  sessionID: SessionID
}) {
  if (input.command.model) {
    return Provider.parseModel(input.command.model)
  }
  if (input.command.agent) {
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

  const available = await (input.list ?? Agent.list)()
    .then((items) => items.filter((item) => Agent.resolveTier(item) !== "internal").map((item) => item.name))
  const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
  const error = new NamedError.Unknown({ message: `Agent not found: "${input.name}".${hint}` })
  if (input.report) input.report(input.sessionID, error.toObject())
  if (!input.report)
    Bus.publish(Session.Event.Error, {
      sessionID: input.sessionID,
      error: error.toObject(),
    })
  throw error
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
      const payload = new NamedError.Unknown({ message: `Model not found: ${providerID}/${modelID}.${hint}` }).toObject()
      if (input.report) input.report(input.sessionID, payload)
      if (!input.report)
        Bus.publish(Session.Event.Error, {
          sessionID: input.sessionID,
          error: payload,
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
    !hasExtra && ((input.agent.mode === "subagent" && input.command.subtask !== false) || input.command.subtask === true)
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
    if (!lastFinished && msg.info.role === "assistant" && msg.info.finish) lastFinished = msg.info as MessageV2.Assistant
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
  if (!lastFinished) return
  // Idempotency check: if the text already starts with the reminder
  // opening tag, this message has been wrapped in a prior iteration —
  // skip it so we don't stack `<system-reminder>` tags and grow the
  // token count on every loop step. The caller's `msgs` array is
  // shared across iterations, so the wrap persists once applied.
  const REMINDER_PREFIX = "<system-reminder>\nThe user sent the following message:"
  for (const msg of msgs) {
    if (msg.info.role !== "user" || msg.info.id <= lastFinished.id) continue
    for (const part of msg.parts) {
      if (part.type !== "text" || part.ignored || part.synthetic) continue
      if (!part.text.trim()) continue
      if (part.text.startsWith(REMINDER_PREFIX)) continue
      part.text = [
        "<system-reminder>",
        "The user sent the following message:",
        part.text,
        "",
        "Please address this message and continue with your tasks.",
        "</system-reminder>",
      ].join("\n")
    }
  }
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
      msgs,
      cached: msgs,
    }
  }

  const lastID = input.cached[input.cached.length - 1]?.info.id
  const newer = await (input.after ?? MessageV2.after)(input.sessionID, lastID)
  if (newer.length > 0) input.cached.push(...newer)
  return {
    msgs: input.cached,
    cached: input.cached,
  }
}

export type SystemCache = {
  environment?: string[]
  environmentModelKey?: string
  instructions?: string[]
  skills?: string | undefined
  skillsAgentKey?: string
  skillsMsgCount?: number
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
  structuredPrompt?: string
}) {
  // Cache skills per agent — only recompute when agent changes or new messages arrive
  const skillsFn = input.skills ?? SystemPrompt.skills
  const msgCount = input.messages?.length ?? 0
  if (
    input.cache.skillsAgentKey !== input.agent.name ||
    input.cache.skillsMsgCount !== msgCount ||
    input.cache.skillsFn !== skillsFn
  ) {
    input.cache.skills = await skillsFn(input.agent, input.messages)
    input.cache.skillsAgentKey = input.agent.name
    input.cache.skillsMsgCount = msgCount
    input.cache.skillsFn = skillsFn
  }
  const skills = input.cache.skills

  const modelKey = `${input.model.providerID}/${input.model.api.id}`
  if (!input.cache.environment || input.cache.environmentModelKey !== modelKey) {
    input.cache.environment = await (input.environment ?? SystemPrompt.environment)(input.model as any)
    input.cache.environmentModelKey = modelKey
  }
  if (!input.cache.instructions) input.cache.instructions = await (input.instructions ?? InstructionPrompt.system)()

  const system = [...input.cache.environment, ...(skills ? [skills] : []), ...input.cache.instructions]
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
        ? path.join(os.homedir(), name.slice(2))
        : path.resolve(Instance.worktree, name)

      const stats = await fs.stat(filepath).catch(() => undefined)
      if (!stats) {
        const agent = await Agent.get(name)
        if (agent) {
          parts.push({
            type: "agent",
            name: agent.name,
          })
        }
        return
      }

      if (stats.isDirectory()) {
        parts.push({
          type: "file",
          url: pathToFileURL(filepath).href,
          filename: name,
          mime: "application/x-directory",
        })
        return
      }

      parts.push({
        type: "file",
        url: pathToFileURL(filepath).href,
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
    retries: 2,
    messages: [
      {
        role: "user",
        content: "Generate a title for this conversation:\n",
      },
      ...(hasOnlySubtaskParts
        ? [{ role: "user" as const, content: subtaskParts.map((p) => p.prompt).join("\n") }]
        : await MessageV2.toModelMessages(contextMessages, model)),
    ],
  })
  // Return undefined explicitly on failure — the previous code relied
  // on `log.error` happening to return void, which works accidentally
  // today but silently breaks if log.error ever returns something
  // truthy.
  const text = await Promise.resolve(result.text).catch((err: any) => {
    log.error("failed to generate title", { error: err })
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
