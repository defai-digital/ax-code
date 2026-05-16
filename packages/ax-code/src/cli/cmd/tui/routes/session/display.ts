import type { MessageWithParts } from "../../util/transcript"

type Message = {
  id: string
  role: string
}

type Part = {
  type?: string
  text?: string
}

export function scrollDelta(
  mode: "page-up" | "page-down" | "line-up" | "line-down" | "half-page-up" | "half-page-down",
  height: number,
) {
  if (mode === "page-up") return -Math.floor(height / 2)
  if (mode === "page-down") return Math.floor(height / 2)
  if (mode === "line-up") return -1
  if (mode === "line-down") return 1
  if (mode === "half-page-up") return -Math.floor(height / 4)
  return Math.floor(height / 4)
}

export function scrollTo(mode: "first" | "last", height: number) {
  if (mode === "first") return 0
  return height
}

export function lastAssistantText(
  messages: Message[],
  parts: Record<string, Part[] | undefined>,
  revert: string | undefined,
) {
  const revertIndex = revert ? messages.findIndex((item) => item.id === revert) : -1
  const message = messages.findLast(
    (item, index) => item.role === "assistant" && (revertIndex === -1 || index < revertIndex),
  )
  if (!message) return { error: "No assistant messages found" as const }

  const text = (parts[message.id] ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim()

  if (!text) return { error: "No text content found in last assistant message" as const }
  return { text }
}

export function transcriptItems(
  messages: MessageWithParts["info"][],
  parts: Record<string, MessageWithParts["parts"][number][] | undefined>,
): MessageWithParts[] {
  return messages.map((info) => ({ info, parts: parts[info.id] ?? [] }))
}
