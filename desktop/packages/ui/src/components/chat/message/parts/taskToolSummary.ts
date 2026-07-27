import type { MessageRecord } from "@/lib/messageCompletion"
import { normalizeToolName } from "./toolPartFormat"

export type TaskToolSummaryEntry = {
  id?: string
  tool?: string
  state?: {
    status?: string
    title?: string
    input?: Record<string, unknown>
  }
}

export type SessionMessageWithParts = MessageRecord

const normalizeSessionIdCandidate = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export const readTaskSessionIdFromRecord = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const record = value as Record<string, unknown>
  return normalizeSessionIdCandidate(record.sessionID) ?? normalizeSessionIdCandidate(record.sessionId)
}

export const readTaskSessionIdFromOutput = (output: string | undefined): string | undefined => {
  if (typeof output !== "string" || output.trim().length === 0) {
    return undefined
  }
  const parsedMetadata = parseTaskMetadataBlock(output)
  if (parsedMetadata.sessionId) {
    return parsedMetadata.sessionId
  }
  const taskMatch = output.match(/task_id\s*:\s*([^\s<"']+)/i)
  const sessionMatch = output.match(/session[_\s-]?id\s*:\s*([^\s<"']+)/i)
  const candidate = taskMatch?.[1] ?? sessionMatch?.[1]
  return normalizeSessionIdCandidate(candidate)
}

export const buildTaskSummaryEntriesFromSession = (messages: SessionMessageWithParts[]): TaskToolSummaryEntry[] => {
  const entries: TaskToolSummaryEntry[] = []

  for (const message of messages) {
    if (message?.info?.role !== "assistant") {
      continue
    }
    const parts = Array.isArray(message.parts) ? message.parts : []
    for (const part of parts) {
      if (part?.type !== "tool") {
        continue
      }
      const toolName = normalizeToolName(part.tool)
      if (!toolName || toolName === "task" || toolName === "todowrite" || toolName === "todoread") {
        continue
      }
      const partState = part.state as { status?: string; title?: string; input?: unknown } | undefined
      entries.push({
        id: part.id,
        tool: part.tool,
        state: {
          status: partState?.status,
          title: partState?.title,
          input:
            partState?.input && typeof partState.input === "object"
              ? (partState.input as Record<string, unknown>)
              : undefined,
        },
      })
    }
  }

  return entries
}

export const buildTaskSessionMessagesSignature = (messages: SessionMessageWithParts[]): string => {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "0"
  }

  const lastMessage = messages[messages.length - 1]
  const lastMessageId = typeof lastMessage?.info?.id === "string" ? lastMessage.info.id : ""
  const lastMessageUpdated =
    typeof lastMessage?.info?.time?.completed === "number"
      ? lastMessage.info.time.completed
      : typeof lastMessage?.info?.time?.created === "number"
        ? lastMessage.info.time.created
        : 0
  const lastParts = Array.isArray(lastMessage?.parts) ? lastMessage.parts : []
  const lastPart = lastParts[lastParts.length - 1] as Record<string, unknown> | undefined
  const tailType = typeof lastPart?.type === "string" ? lastPart.type : ""
  const tailId = typeof lastPart?.id === "string" ? lastPart.id : ""
  const tailTextLength = (() => {
    const textCandidate = lastPart?.text
    if (typeof textCandidate === "string") {
      return textCandidate.length
    }
    const stateCandidate = lastPart?.state
    if (stateCandidate && typeof stateCandidate === "object") {
      const stateStatus = (stateCandidate as Record<string, unknown>).status
      if (typeof stateStatus === "string") {
        return stateStatus.length
      }
    }
    return 0
  })()

  return `${messages.length}:${lastMessageId}:${lastMessageUpdated}:${lastParts.length}:${tailType}:${tailId}:${tailTextLength}`
}

export const getTaskSummaryLabel = (entry: TaskToolSummaryEntry): string => {
  const title = entry.state?.title
  if (typeof title === "string" && title.trim().length > 0) {
    return title
  }

  const input = entry.state?.input
  if (input && typeof input === "object") {
    const pathCandidate = input.filePath ?? input.file_path ?? input.path
    if (typeof pathCandidate === "string" && pathCandidate.trim().length > 0) {
      return pathCandidate.trim()
    }

    const urlCandidate = input.url
    if (typeof urlCandidate === "string" && urlCandidate.trim().length > 0) {
      return urlCandidate.trim()
    }
  }

  return ""
}

const FILE_PATH_LABEL_TOOLS = new Set([
  "read",
  "view",
  "file_read",
  "cat",
  "write",
  "create",
  "file_write",
  "edit",
  "multiedit",
  "apply_patch",
])

export const shouldRenderGitPathLabel = (toolName: string, label: string): boolean => {
  if (!FILE_PATH_LABEL_TOOLS.has(toolName.toLowerCase())) {
    return false
  }

  const trimmed = label.trim()
  if (!trimmed || trimmed === "Patch" || /^\d+\s+files$/.test(trimmed)) {
    return false
  }

  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return true
  }

  const baseName = trimmed.split(/[\\/]/).pop() || trimmed
  if (baseName.startsWith(".") || baseName.includes(".")) {
    return true
  }

  return /^[A-Za-z0-9_-]+$/.test(baseName)
}

export const stripTaskMetadataFromOutput = (output: string): string => {
  // Strip only a trailing <task_metadata>...</task_metadata> block.
  return output.replace(/\n*<task_metadata>[\s\S]*?<\/task_metadata>\s*$/i, "").trimEnd()
}

export const normalizeTaskSummaryEntries = (value: unknown): TaskToolSummaryEntry[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: TaskToolSummaryEntry[] = []
  for (const entry of value) {
    if (typeof entry === "string") {
      normalized.push({
        tool: "tool",
        state: { status: "completed", title: entry },
      })
      continue
    }

    if (!entry || typeof entry !== "object") {
      continue
    }

    const record = entry as {
      id?: unknown
      tool?: unknown
      title?: unknown
      status?: unknown
      state?: { status?: unknown; title?: unknown; input?: unknown }
    }

    const stateStatus = typeof record.state?.status === "string" ? record.state.status : undefined
    const stateTitle = typeof record.state?.title === "string" ? record.state.title : undefined
    const status = stateStatus ?? (typeof record.status === "string" ? record.status : undefined)
    const title = stateTitle ?? (typeof record.title === "string" ? record.title : undefined)

    normalized.push({
      id: typeof record.id === "string" ? record.id : undefined,
      tool: typeof record.tool === "string" ? record.tool : "tool",
      state: {
        status,
        title,
        input:
          record.state?.input && typeof record.state.input === "object"
            ? (record.state.input as Record<string, unknown>)
            : undefined,
      },
    })
  }

  return normalized
}

export const parseTaskMetadataBlock = (
  output: string | undefined,
): {
  sessionId?: string
  summaryEntries: TaskToolSummaryEntry[]
} => {
  if (typeof output !== "string" || output.trim().length === 0) {
    return { summaryEntries: [] }
  }

  const blockMatch = output.match(/<task_metadata>\s*([\s\S]*?)\s*<\/task_metadata>/i)
  if (!blockMatch?.[1]) {
    return { summaryEntries: [] }
  }

  const raw = blockMatch[1].trim()
  if (!raw) {
    return { summaryEntries: [] }
  }

  try {
    const parsed = JSON.parse(raw) as {
      sessionId?: unknown
      sessionID?: unknown
      summary?: unknown
      entries?: unknown
      tools?: unknown
      calls?: unknown
    }

    const summaryEntries = normalizeTaskSummaryEntries(parsed.summary ?? parsed.entries ?? parsed.tools ?? parsed.calls)

    const sessionId =
      (typeof parsed.sessionId === "string" && parsed.sessionId.trim().length > 0
        ? parsed.sessionId.trim()
        : undefined) ??
      (typeof parsed.sessionID === "string" && parsed.sessionID.trim().length > 0 ? parsed.sessionID.trim() : undefined)

    return { sessionId, summaryEntries }
  } catch {
    return { summaryEntries: [] }
  }
}
