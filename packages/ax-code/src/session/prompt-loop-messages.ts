import { MessageV2 } from "./message-v2"
import type { SessionID } from "./schema"

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
