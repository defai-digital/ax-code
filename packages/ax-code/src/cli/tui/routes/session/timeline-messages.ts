import type { Message, Part, TextPart, UserMessage } from "@ax-code/sdk/v2"

type TimelineEntry = { message: UserMessage; title: string }

/** Shared timeline/fork eligibility; keep projection order and never mutate cached messages. */
export function timelineEntries(
  messages: readonly Message[],
  parts: Readonly<Record<string, readonly Part[] | undefined>>,
): TimelineEntry[] {
  const result: TimelineEntry[] = []
  for (const message of messages) {
    if (message.role !== "user") continue
    const text = (parts[message.id] ?? []).find(
      (part): part is TextPart =>
        part.type === "text" && !part.synthetic && !part.ignored && part.text.trim().length > 0,
    )
    if (!text) continue
    result.push({ message, title: text.text.replace(/\n/g, " ") })
  }
  return result.reverse()
}
