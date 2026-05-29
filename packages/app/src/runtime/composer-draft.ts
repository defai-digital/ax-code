import type { AppComposerAttachment, ComposerAttachmentKind, QueueDraftMode } from "./actions"

export const COMPOSER_DRAFT_STORAGE_KEY = "ax-code.app.composer-draft"

export type StoredComposerDraft = {
  text?: string
  mode?: QueueDraftMode
  agent?: string
  modelKey?: string
  worktreeDirectory?: string
  attachments?: AppComposerAttachment[]
}

type ComposerDraftStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const STORED_COMPOSER_DRAFT_VERSION = 2
const DRAFT_MODES = new Set<QueueDraftMode>(["prompt", "command", "shell"])
const ATTACHMENT_KINDS = new Set<ComposerAttachmentKind>(["file", "image", "directory", "context"])

export function readStoredComposerDraft(storage = browserLocalStorage()): StoredComposerDraft | undefined {
  if (!storage) return undefined
  try {
    const raw = storage.getItem(COMPOSER_DRAFT_STORAGE_KEY)
    if (!raw || raw.trim().length === 0) return undefined
    try {
      const value = JSON.parse(raw) as unknown
      return normalizeStoredComposerDraft(value)
    } catch {
      return { text: raw }
    }
  } catch {
    return undefined
  }
}

export function writeStoredComposerDraft(draft: StoredComposerDraft, storage = browserLocalStorage()) {
  if (!storage) return
  try {
    const normalized = normalizeStoredComposerDraft({ version: STORED_COMPOSER_DRAFT_VERSION, ...draft })
    if (!normalized || composerDraftEmpty(normalized)) {
      storage.removeItem(COMPOSER_DRAFT_STORAGE_KEY)
      return
    }
    storage.setItem(
      COMPOSER_DRAFT_STORAGE_KEY,
      JSON.stringify({
        version: STORED_COMPOSER_DRAFT_VERSION,
        ...normalized,
      }),
    )
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

function normalizeStoredComposerDraft(value: unknown): StoredComposerDraft | undefined {
  const record = readRecord(value)
  const mode = readMode(record["mode"])
  const text = readNonEmptyString(record["text"])
  const agent = readNonEmptyString(record["agent"])
  const modelKey = readNonEmptyString(record["modelKey"])
  const worktreeDirectory = readNonEmptyString(record["worktreeDirectory"])
  const attachments = Array.isArray(record["attachments"])
    ? record["attachments"].map(normalizeStoredAttachment).filter((item): item is AppComposerAttachment => Boolean(item))
    : undefined
  const normalized: StoredComposerDraft = {}
  if (text) normalized.text = text
  if (mode) normalized.mode = mode
  if (agent) normalized.agent = agent
  if (modelKey) normalized.modelKey = modelKey
  if (worktreeDirectory) normalized.worktreeDirectory = worktreeDirectory
  if (attachments && attachments.length > 0) normalized.attachments = attachments
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeStoredAttachment(value: unknown): AppComposerAttachment | undefined {
  const record = readRecord(value)
  const id = readNonEmptyString(record["id"])
  const kind = readAttachmentKind(record["kind"])
  const path = readNonEmptyString(record["path"])
  const mime = readNonEmptyString(record["mime"])
  if (!id || !kind || !path || !mime) return undefined
  if (path.trim().toLowerCase().startsWith("data:")) return undefined
  const filename = readNonEmptyString(record["filename"])
  const startLine = readPositiveInteger(record["startLine"])
  const endLine = readPositiveInteger(record["endLine"])
  if (kind === "context" && startLine !== undefined && endLine !== undefined && endLine < startLine) return undefined
  return {
    id,
    kind,
    path,
    mime,
    ...(filename ? { filename } : {}),
    ...(startLine !== undefined ? { startLine } : {}),
    ...(endLine !== undefined ? { endLine } : {}),
  }
}

function composerDraftEmpty(draft: StoredComposerDraft) {
  return (
    !draft.text?.trim() &&
    (!draft.mode || draft.mode === "prompt") &&
    !draft.agent?.trim() &&
    !draft.modelKey?.trim() &&
    !draft.worktreeDirectory?.trim() &&
    (!draft.attachments || draft.attachments.length === 0)
  )
}

function browserLocalStorage(): ComposerDraftStorage | undefined {
  try {
    return globalThis.window?.localStorage
  } catch {
    return undefined
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function readMode(value: unknown): QueueDraftMode | undefined {
  return typeof value === "string" && DRAFT_MODES.has(value as QueueDraftMode) ? (value as QueueDraftMode) : undefined
}

function readAttachmentKind(value: unknown): ComposerAttachmentKind | undefined {
  return typeof value === "string" && ATTACHMENT_KINDS.has(value as ComposerAttachmentKind)
    ? (value as ComposerAttachmentKind)
    : undefined
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function readPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}
