import type { AssistantMessage, Part, UserMessage } from "@ax-code/sdk/v2"
import { userRoute, type AgentInfo } from "./route"
import { filetype } from "./format"

type TodoViewItem = {
  status: string
  content: string
}

type Message = {
  id: string
  role: string
}

type TextPart = Extract<Part, { type: "text" }>
type FilePart = Extract<Part, { type: "file" }>

export type SessionTaskSummary = {
  running: number
  done: number
  total: number
}

export type UserMetadataPreference = "auto" | "full" | "compact"
export type UserMetadataDensity = "full" | "compact"

export type TodoWriteView =
  | {
      state: "pending"
      todos: TodoViewItem[]
    }
  | {
      state: "items" | "empty"
      todos: TodoViewItem[]
    }

export type DiffDisplayView = {
  view: "split" | "unified"
  filetype: string
  wrapMode: "word" | "none"
}

export type CodeDisplayView = {
  filetype: string
  content: string
}

function isTextPart(part: Part): part is TextPart {
  return part.type === "text" && !part.synthetic
}

function isFilePart(part: Part): part is FilePart {
  return part.type === "file"
}

export function sessionTaskSummary(messages: Message[], parts: Record<string, Part[] | undefined>): SessionTaskSummary {
  let running = 0
  let done = 0

  for (const message of messages) {
    for (const part of parts[message.id] ?? []) {
      if (part.type !== "tool" || part.tool !== "task") continue
      const status = part.state.status
      if (status === "running" || status === "pending") running++
      else if (status === "completed") done++
    }
  }

  return { running, done, total: running + done }
}

function todos(value: unknown): TodoViewItem[] | undefined {
  if (!Array.isArray(value)) return
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const todo = item as Partial<TodoViewItem>
    if (typeof todo.status !== "string" || typeof todo.content !== "string") return []
    return [{ status: todo.status, content: todo.content }]
  })
}

function outputTodos(output: string | undefined): TodoViewItem[] | undefined {
  if (!output) return
  try {
    return todos(JSON.parse(output))
  } catch {
    return
  }
}

export function todoWriteView(input: {
  status: string
  inputTodos?: unknown
  metadataTodos?: unknown
  output?: string
}): TodoWriteView {
  const resolved = todos(input.metadataTodos) ?? todos(input.inputTodos) ?? outputTodos(input.output)
  if (resolved) {
    return {
      state: resolved.length > 0 ? "items" : "empty",
      todos: resolved,
    }
  }
  return {
    state: input.status === "completed" ? "empty" : "pending",
    todos: [],
  }
}

export function assistantMessageDuration(
  message: AssistantMessage,
  messages: Array<Pick<Message, "id" | "role"> & { time?: { created?: number } }>,
) {
  if (!message.finish || ["tool-calls", "unknown"].includes(message.finish)) return 0
  if (!message.time.completed) return 0
  const user = messages.find((item) => item.role === "user" && item.id === message.parentID)
  if (!user?.time?.created) return 0
  return message.time.completed - user.time.created
}

export function userMessageView(input: {
  message: UserMessage
  parts: Part[]
  agents?: AgentInfo[]
  pending?: string
  showTimestamps: boolean
  width?: number
  metadataPreference?: UserMetadataPreference
}) {
  const text = input.parts.find(isTextPart)
  const files = input.parts.filter(isFilePart)
  const compaction = input.parts.find((part) => part.type === "compaction")
  const queued = !!input.pending && input.message.id > input.pending
  const route = userRoute(input.message, input.parts, input.agents)
  const showPrimary = input.message.agent !== "build" || route.delegated.length > 0
  const metadataVisible = queued || input.showTimestamps || showPrimary || route.delegated.length > 0
  const metadataDensity = userMessageMetadataDensity({
    width: input.width ?? Number.MAX_SAFE_INTEGER,
    preference: input.metadataPreference ?? "auto",
  })

  return {
    text,
    files,
    compaction,
    queued,
    route,
    showPrimary,
    metadataVisible,
    metadataDensity,
    compactDelegatedLabel: compactDelegatedLabel(route.delegated.length),
  }
}

export function userMessageMetadataDensity(input: {
  width: number
  preference: UserMetadataPreference
}): UserMetadataDensity {
  if (input.preference === "full") return "full"
  if (input.preference === "compact") return "compact"
  return input.width < 100 ? "compact" : "full"
}

export function compactDelegatedLabel(count: number) {
  if (count <= 0) return
  return count === 1 ? "1 delegated" : `${count} delegated`
}

export function diffDisplayView(input: {
  diffStyle: string | undefined
  width: number
  filePath?: string
  wrapMode: "word" | "none"
}): DiffDisplayView {
  return {
    view: input.diffStyle === "stacked" || input.width <= 120 ? "unified" : "split",
    filetype: filetype(input.filePath),
    wrapMode: input.wrapMode,
  }
}

export function codeDisplayView(input: { filePath?: string; content?: string }): CodeDisplayView {
  return {
    filetype: filetype(input.filePath),
    content: input.content ?? "",
  }
}
