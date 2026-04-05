import type { FollowupDraft } from "@/components/prompt-input/submit"

export type QueuedFollowup = FollowupDraft & { id: string }

type Editing = {
  id: string
  prompt: FollowupDraft["prompt"]
  context: FollowupDraft["context"]
}

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

export const queuedFollowups = (
  items: Record<string, QueuedFollowup[] | undefined>,
  sessionID: string | undefined,
  empty: QueuedFollowup[],
) => {
  if (!sessionID) return empty
  return items[sessionID] ?? empty
}

export const editingFollowup = (
  items: Record<string, Editing | undefined>,
  sessionID: string | undefined,
) => {
  if (!sessionID) return
  return items[sessionID]
}

export const pausedFollowup = (
  items: Record<string, boolean | undefined>,
  sessionID: string | undefined,
) => {
  if (!sessionID) return false
  return !!items[sessionID]
}

export const failedFollowup = (
  items: Record<string, string | undefined>,
  sessionID: string | undefined,
) => {
  if (!sessionID) return
  return items[sessionID]
}

export const getFollowup = (items: Record<string, QueuedFollowup[] | undefined>, sessionID: string, id: string) =>
  (items[sessionID] ?? []).find((entry) => entry.id === id)

export const followupDock = (items: QueuedFollowup[], attachmentLabel: string) =>
  items.map((item) => ({ id: item.id, text: getFollowupText(item, attachmentLabel) }))

export const followupPending = (
  pending: boolean,
  vars: { sessionID: string; id?: string } | undefined,
  sessionID: string,
) => pending && vars?.sessionID === sessionID

export const followupSending = (
  pending: boolean,
  vars: { sessionID: string; id?: string } | undefined,
  sessionID: string | undefined,
) => {
  if (!sessionID) return
  if (!followupPending(pending, vars, sessionID)) return
  return vars?.id
}

export const queueFollowupState = (
  items: QueuedFollowup[] | undefined,
  draft: FollowupDraft,
  id: string,
) => ({
  items: appendFollowup(items, draft, id),
  failed: undefined as string | undefined,
})

export const editFollowupState = (
  items: QueuedFollowup[] | undefined,
  failed: string | undefined,
  id: string,
) => {
  const item = (items ?? []).find((entry) => entry.id === id)
  if (!item) return
  return {
    items: removeFollowup(items, id),
    failed: failed === id ? undefined : failed,
    edit: {
      id: item.id,
      prompt: item.prompt,
      context: item.context,
    },
  }
}

export const removeFollowupState = (
  items: QueuedFollowup[] | undefined,
  failed: string | undefined,
  id: string,
) => ({
  items: removeFollowup(items, id),
  failed: failed === id ? undefined : failed,
})

export const queueEnabled = (input: {
  sessionID?: string
  mode: string
  busy: boolean
  blocked: boolean
}) => {
  if (!input.sessionID) return false
  return input.mode === "queue" && input.busy && !input.blocked
}

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
