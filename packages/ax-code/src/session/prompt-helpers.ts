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

const log = Log.create({ service: "session.prompt" })

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

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

const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export function commandTemplate(templateCommand: string, args: string): string {
  const raw = args.match(argsRegex) ?? []
  const parsed = raw.map((arg) => arg.replace(quoteTrimRegex, ""))

  const placeholders = templateCommand.match(placeholderRegex) ?? []
  let last = 0
  for (const item of placeholders) {
    const value = Number(item.slice(1))
    if (value > last) last = value
  }

  const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
    const position = Number(index)
    const argIndex = position - 1
    if (argIndex >= parsed.length) return ""
    if (position === last) return parsed.slice(argIndex).join(" ")
    return parsed[argIndex]
  })

  const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
  let template = withArgs.replaceAll("$ARGUMENTS", args)

  if (placeholders.length === 0 && !usesArgumentsPlaceholder && args.trim()) {
    template = template + "\n\n" + args
  }

  return template
}

export async function commandModel(input: {
  command: Command.Info
  model: string | undefined
  sessionID: SessionID
}) {
  const { command, model, sessionID } = input
  if (command.model) return Provider.parseModel(command.model)
  if (command.agent) {
    const cmdAgent = await Agent.get(command.agent)
    if (cmdAgent?.model) return cmdAgent.model
  }
  if (model) return Provider.parseModel(model)
  return lastModel(sessionID)
}

export async function commandParts(input: {
  agent: Awaited<ReturnType<typeof Agent.get>> & {}
  command: Command.Info
  name: string
  model: { providerID: string; modelID: string }
  template: string
  parts: any[] | undefined
}) {
  const { agent, command, name, model, template, parts } = input
  const templateParts = await resolvePromptParts(template)
  const isSubtask = (agent.mode === "subagent" && command.subtask !== false) || command.subtask === true
  const resolved = isSubtask
    ? [
        {
          type: "subtask" as const,
          agent: agent.name,
          description: command.description ?? "",
          command: name,
          model: {
            providerID: model.providerID,
            modelID: model.modelID,
          },
          prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
        },
      ]
    : [...templateParts, ...(parts ?? [])]
  return { subtask: isSubtask, parts: resolved }
}

export async function ensureTitle(input: {
  session: Session.Info
  history: MessageV2.WithParts[]
  providerID: ProviderID
  modelID: ModelID
}) {
  if (input.session.parentID) return
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
    abort: new AbortController().signal,
    sessionID: input.session.id,
    retries: 2,
    messages: [
      {
        role: "user",
        content: "Generate a title for this conversation:\n",
      },
      ...(hasOnlySubtaskParts
        ? [{ role: "user" as const, content: subtaskParts.map((p) => p.prompt).join("\n") }]
        : MessageV2.toModelMessages(contextMessages, model)),
    ],
  })
  const text = await result.text.catch((err) => log.error("failed to generate title", { error: err }))
  if (text) {
    const cleaned = text
      .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0)
    if (!cleaned) return

    const title = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
    return Session.setTitle({ sessionID: input.session.id, title }).catch((err) => {
      if (NotFoundError.isInstance(err)) return
      throw err
    })
  }
}
