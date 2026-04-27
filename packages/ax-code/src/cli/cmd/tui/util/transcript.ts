import type { AssistantMessage, Part, UserMessage } from "@ax-code/sdk/v2"
import { agentLabel, userRoute, type AgentInfo } from "../routes/session/route"

export type TranscriptOptions = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
}

export type SessionInfo = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

export type MessageWithParts = {
  info: UserMessage | AssistantMessage
  parts: Part[]
}

export { agentLabel, userRoute, type AgentInfo } from "../routes/session/route"

function fence(content: string, language?: string) {
  const maxBackticks = Math.max(...(content.match(/`+/g) ?? []).map((item) => item.length), 0)
  const marker = "`".repeat(Math.max(3, maxBackticks + 1))
  return `${marker}${language ?? ""}\n${content}\n${marker}\n`
}

export function formatUserHeader(msg: UserMessage, parts: Part[], agents?: AgentInfo[]) {
  const route = userRoute(msg, parts, agents)
  if (msg.agent === "build" && route.delegated.length === 0) return `## User\n\n`
  const delegated =
    route.delegated.length > 0 ? ` · delegated to ${route.delegated.map((item) => item.label).join(", ")}` : ""
  return `## User (${route.primary.label}${delegated})\n\n`
}

export function formatTranscript(
  session: SessionInfo,
  messages: MessageWithParts[],
  options: TranscriptOptions & { agents?: AgentInfo[] },
): string {
  let transcript = `# ${session.title}\n\n`
  transcript += `**Session ID:** ${session.id}\n`
  transcript += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`
  transcript += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n`
  transcript += `---\n\n`

  for (const msg of messages) {
    transcript += formatMessage(msg.info, msg.parts, options)
    transcript += `---\n\n`
  }

  return transcript
}

export function formatMessage(
  msg: UserMessage | AssistantMessage,
  parts: Part[],
  options: TranscriptOptions & { agents?: AgentInfo[] },
): string {
  let result = ""

  if (msg.role === "user") {
    result += formatUserHeader(msg, parts, options.agents)
  } else {
    result += formatAssistantHeader(msg, options.assistantMetadata, options.agents)
  }

  for (const part of parts) {
    result += formatPart(part, options)
  }

  return result
}

export function formatAssistantHeader(msg: AssistantMessage, includeMetadata: boolean, agents?: AgentInfo[]): string {
  if (!includeMetadata) {
    return `## Assistant\n\n`
  }

  const duration =
    msg.time.completed && msg.time.created ? ((msg.time.completed - msg.time.created) / 1000).toFixed(1) + "s" : ""
  const label = agentLabel(msg.agent, agents)

  return `## Assistant (${label} · ${msg.modelID}${duration ? ` · ${duration}` : ""})\n\n`
}

export function formatPart(part: Part, options: TranscriptOptions): string {
  if (part.type === "text" && !part.synthetic) {
    return `${part.text}\n\n`
  }

  if (part.type === "reasoning") {
    if (options.thinking) {
      return `_Thinking:_\n\n${part.text}\n\n`
    }
    return ""
  }

  if (part.type === "tool") {
    let result = `**Tool: ${part.tool}**\n`
    if (options.toolDetails && part.state.input) {
      result += `\n**Input:**\n${fence(JSON.stringify(part.state.input, null, 2), "json")}`
    }
    if (options.toolDetails && part.state.status === "completed" && part.state.output) {
      result += `\n**Output:**\n${fence(part.state.output)}`
    }
    if (options.toolDetails && part.state.status === "error" && part.state.error) {
      result += `\n**Error:**\n${fence(part.state.error)}`
    }
    result += `\n`
    return result
  }

  return ""
}
