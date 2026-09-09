import type { MessageV2 } from "./message-v2"

/** Move only our request-only dynamic parts; original user/assistant/tool content stays in order. */
export function projectTailReminders(messages: MessageV2.WithParts[]) {
  const reminders: string[] = []
  const projected = messages.map((message) => {
    if (message.info.role !== "user") return message
    const parts = message.parts.filter((part) => {
      if (part.type !== "text" || !part.synthetic || part.metadata?.axDynamicReminder !== true) return true
      reminders.push(part.text)
      return false
    })
    return parts.length === message.parts.length ? message : { ...message, parts }
  })
  return { messages: projected, reminder: reminders.length ? reminders.join("\n\n") : undefined }
}
