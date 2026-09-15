import type { PromptInfo } from "./prompt-info"

export type SessionPromptDraft = {
  prompt: PromptInfo
  mode: "normal" | "shell"
  cursor: number
  expandedPastes: number[]
}

export function promptDraftKey(directory: string | undefined, sessionID: string | undefined) {
  return JSON.stringify([directory ?? "", sessionID ?? null])
}

/** Owned by the mounted TUI, never persisted or shared with another client. */
export function createSessionPromptDrafts() {
  const drafts = new Map<string, SessionPromptDraft>()
  return {
    take(key: string) {
      const draft = drafts.get(key)
      drafts.delete(key)
      return draft
    },
    save(key: string, draft: SessionPromptDraft) {
      if (!draft.prompt.input && draft.prompt.parts.length === 0 && draft.mode === "normal") {
        drafts.delete(key)
        return
      }
      drafts.set(key, structuredClone(draft))
    },
    clear(key: string) {
      drafts.delete(key)
    },
  }
}

/** A submitted Home draft remains on screen until handoff, but is consumed. */
export function createSessionPromptDraftLifecycle(input: {
  drafts: ReturnType<typeof createSessionPromptDrafts>
  key: string
  read: () => SessionPromptDraft
  restore: (draft: SessionPromptDraft) => void
}) {
  let consumed = false
  return {
    restore() {
      const saved = input.drafts.take(input.key)
      if (saved) input.restore(saved)
    },
    edited() {
      consumed = false
    },
    submitted() {
      consumed = true
      input.drafts.clear(input.key)
    },
    dispose() {
      if (consumed) return
      input.drafts.save(input.key, input.read())
    },
  }
}

/** Apply an explicit route draft only to the editor whose ref just mounted. */
export function applyInitialPromptDraft(input: {
  initial: PromptInfo | undefined
  set: (prompt: PromptInfo) => void
  consume: () => void
}) {
  if (!input.initial) return
  input.set(input.initial)
  input.consume()
}
