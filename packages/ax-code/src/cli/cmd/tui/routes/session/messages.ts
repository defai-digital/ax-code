import type { PromptInfo } from "../../component/prompt/history"

type Message = {
  id: string
  role: string
}

type Part = {
  type?: string
  synthetic?: boolean
  ignored?: boolean
  text?: string
  id?: string
  messageID?: string
  sessionID?: string
  filename?: string
  url?: string
  mime?: string
  [key: string]: unknown
}

function isVisibleTextPart(part: Part) {
  return part.type === "text" && !part.synthetic && !part.ignored
}

function hasText(parts: Part[] | undefined) {
  if (!parts || !Array.isArray(parts)) return false
  return parts.some(isVisibleTextPart)
}

function toPromptPart(part: Part): PromptInfo["parts"][number] | undefined {
  if (part.type !== "file" && part.type !== "agent") return
  const { id: _id, messageID: _messageID, sessionID: _sessionID, ...rest } = part
  return rest as PromptInfo["parts"][number]
}

export function lastUserMessageID(messages: Message[], parts: Record<string, Part[] | undefined>) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || message.role !== "user") continue
    if (hasText(parts[message.id])) return message.id
  }
}

export function undoMessageID(messages: Message[], revert: string | undefined) {
  if (!revert) return messages.findLast((message) => message.role === "user")?.id
  // Use array index rather than lexicographic comparison on ID strings,
  // matching the approach in revert.ts which is resilient to ID format changes.
  const revertIndex = messages.findIndex((m) => m.id === revert)
  if (revertIndex === -1) return messages.findLast((message) => message.role === "user")?.id
  return messages.slice(0, revertIndex).findLast((message) => message.role === "user")?.id
}

export function redoMessageID(messages: Message[], revert: string | undefined) {
  if (!revert) return
  // Use array index rather than lexicographic comparison on ID strings.
  const revertIndex = messages.findIndex((m) => m.id === revert)
  if (revertIndex === -1) return
  return messages.slice(revertIndex + 1).find((message) => message.role === "user")?.id
}

export function promptState(parts: Part[] | undefined): PromptInfo {
  const state: PromptInfo = {
    input: "",
    parts: [],
  }

  for (const part of parts ?? []) {
    if (isVisibleTextPart(part)) state.input += part.text ?? ""

    const promptPart = toPromptPart(part)
    if (promptPart) state.parts.push(promptPart)
  }

  return state
}
