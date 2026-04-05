import type { FollowupDraft } from "@/components/prompt-input/submit"

export type QueuedFollowup = FollowupDraft & { id: string }

export const getFollowupText = (item: FollowupDraft, attachmentLabel: string) => {
  const text = item.prompt
    .map((part) => {
      if (part.type === "image") return `[image:${part.filename}]`
      if (part.type === "file") return `[file:${part.path}]`
      if (part.type === "agent") return `@${part.name}`
      return part.content
    })
    .join("")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => !!line)

  if (text) return text
  return `[${attachmentLabel}]`
}

export const appendFollowup = (
  items: QueuedFollowup[] | undefined,
  draft: FollowupDraft,
  id: string,
): QueuedFollowup[] => [...(items ?? []), { id, ...draft }]

export const removeFollowup = (items: QueuedFollowup[] | undefined, id: string) =>
  (items ?? []).filter((item) => item.id !== id)

export const updateRecentChecks = (
  list: { command: string; title: string }[],
  item: { command: string; title?: string },
) => {
  const cmd = item.command.trim()
  if (!cmd) return list
  return [{ command: cmd, title: item.title?.trim() || cmd }, ...list.filter((entry) => entry.command !== cmd)].slice(
    0,
    4,
  )
}

export const shouldAutoSendFollowup = (input: {
  item?: { id: string }
  sending: boolean
  failed?: string
  paused?: boolean
  blocked: boolean
  busy: boolean
}) => {
  if (!input.item) return false
  if (input.sending) return false
  if (input.failed === input.item.id) return false
  if (input.paused) return false
  if (input.blocked) return false
  if (input.busy) return false
  return true
}
