import type { Part } from "@ax-code/sdk/v2"

type Message = {
  id: string
  role: string
}

export function firstCompactionMessageID(messages: Message[], parts: Record<string, Part[] | undefined>) {
  for (const message of messages) {
    if (message.role !== "user") continue
    if ((parts[message.id] ?? []).some((part) => part.type === "compaction")) return message.id
  }
}

export function shouldShowCompactionNotice(input: {
  currentMessageID: string
  firstMessageID?: string
  dismissed: boolean
}) {
  return !input.dismissed && input.currentMessageID === input.firstMessageID
}
