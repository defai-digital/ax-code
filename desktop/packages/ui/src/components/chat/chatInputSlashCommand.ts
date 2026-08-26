export type ChatSlashCommandName =
  | "undo"
  | "redo"
  | "timeline"
  | "compact"
  | "summary"
  | "workspace-review"
  | "plan"
  | "plan-feature"
  | "catch-up"
  | "debug"
  | "weigh"
  | "explore"

export type ChatSlashCommand = {
  name: ChatSlashCommandName
  rest: string
}

const SLASH_COMMANDS = new Set<ChatSlashCommandName>([
  "undo",
  "redo",
  "timeline",
  "compact",
  "summary",
  "workspace-review",
  "plan",
  "plan-feature",
  "catch-up",
  "debug",
  "weigh",
  "explore",
])

export const parseChatSlashCommand = (text: string, inputMode = "normal"): ChatSlashCommand | null => {
  if (inputMode !== "normal") return null
  const trimmed = text.trimStart()
  if (!trimmed.startsWith("/")) return null
  const [rawName = "", ...restParts] = trimmed.slice(1).trim().split(/\s+/)
  const name = rawName.toLowerCase()
  if (!SLASH_COMMANDS.has(name as ChatSlashCommandName)) return null
  return { name: name as ChatSlashCommandName, rest: restParts.join(" ").trim() }
}
