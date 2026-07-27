import React from "react"

import {
  CHAT_DRAFT_PERSIST_DEBOUNCE_MS,
  getDraftKey,
  getStoredDraft,
  saveStoredDraft,
} from "../chatInputDraftPersistence"
import { loadConfirmedMentions, pruneConfirmedMentions, saveConfirmedMentions } from "../chatInputMentions"

interface UseChatInputDraftPersistenceInput {
  currentSessionId: string | null
  persistChatDraft: boolean
  message: string
  setMessage: React.Dispatch<React.SetStateAction<string>>
  setInputMode: React.Dispatch<React.SetStateAction<"normal" | "shell">>
  messageRef: React.RefObject<string>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  confirmedMentionsRef: React.RefObject<Set<string>>
  initialDraftRef: React.RefObject<string | null>
  initialSessionIdRef: React.RefObject<string | null>
}

// Per-session composer draft persistence: keeps messageRef in sync, handles
// the initial draft restore (select-all or clear when the setting is off),
// swaps drafts on session switch, persists changes debounced, and flushes the
// final draft on unmount. Extracted from ChatInput-impl.tsx — debounce timing,
// storage keys, and effect ordering must stay byte-identical.
export const useChatInputDraftPersistence = ({
  currentSessionId,
  persistChatDraft,
  message,
  setMessage,
  setInputMode,
  messageRef,
  textareaRef,
  confirmedMentionsRef,
  initialDraftRef,
  initialSessionIdRef,
}: UseChatInputDraftPersistenceInput): void => {
  const draftPersistTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextDraftPersistRef = React.useRef(false)
  const lastPersistedDraftRef = React.useRef<Map<string, string>>(new Map())
  const currentSessionIdForDraftRef = React.useRef<string | null>(null)

  // Keep messageRef in sync with message state
  React.useEffect(() => {
    messageRef.current = message
  }, [message, messageRef])

  React.useEffect(() => {
    currentSessionIdForDraftRef.current = currentSessionId
  }, [currentSessionId])

  const persistDraftImmediately = React.useCallback(
    (sessionId: string | null, draft: string) => {
      const key = getDraftKey(sessionId)
      const lastPersisted = lastPersistedDraftRef.current.get(key)
      if (lastPersisted === draft) {
        return
      }

      saveStoredDraft(sessionId, draft)
      // Only persist confirmed mentions that are actually present in the draft text
      const activeMentions = pruneConfirmedMentions(confirmedMentionsRef.current, draft)
      confirmedMentionsRef.current = activeMentions
      saveConfirmedMentions(sessionId, activeMentions)
      lastPersistedDraftRef.current.set(key, draft)
    },
    [confirmedMentionsRef],
  )

  const clearPendingDraftPersist = React.useCallback(() => {
    if (!draftPersistTimerRef.current) {
      return
    }
    clearTimeout(draftPersistTimerRef.current)
    draftPersistTimerRef.current = null
  }, [])

  // Handle initial draft restoration and text selection
  const hasHandledInitialDraftRef = React.useRef(false)
  React.useEffect(() => {
    if (hasHandledInitialDraftRef.current) return
    hasHandledInitialDraftRef.current = true

    const draft = initialDraftRef.current
    if (!draft) return

    if (!persistChatDraft) {
      // Setting disabled - clear the restored draft
      setMessage("")
      try {
        localStorage.removeItem(getDraftKey(initialSessionIdRef.current))
      } catch {
        // Ignore
      }
    } else {
      // Setting enabled - select all text
      requestAnimationFrame(() => {
        textareaRef.current?.select()
      })
    }
  }, [persistChatDraft, initialDraftRef, initialSessionIdRef, setMessage, textareaRef])

  // Handle session switching: save draft for old session, restore draft for new session
  const prevSessionIdRef = React.useRef(currentSessionId)
  React.useEffect(() => {
    if (prevSessionIdRef.current !== currentSessionId) {
      const oldSessionId = prevSessionIdRef.current
      prevSessionIdRef.current = currentSessionId
      setInputMode("normal")
      clearPendingDraftPersist()
      skipNextDraftPersistRef.current = true

      if (persistChatDraft) {
        // Save current draft for the session we're leaving
        persistDraftImmediately(oldSessionId, messageRef.current)
        // Restore draft for the session we're entering
        const newDraft = getStoredDraft(currentSessionId)
        setMessage(newDraft)
        confirmedMentionsRef.current = loadConfirmedMentions(currentSessionId)
        if (newDraft) {
          requestAnimationFrame(() => {
            textareaRef.current?.select()
          })
        }
      } else {
        // Persist disabled: clear input without saving
        setMessage("")
        confirmedMentionsRef.current = new Set()
      }
    }
  }, [
    clearPendingDraftPersist,
    currentSessionId,
    persistChatDraft,
    persistDraftImmediately,
    confirmedMentionsRef,
    messageRef,
    setInputMode,
    setMessage,
    textareaRef,
  ])

  // Persist chat input draft to localStorage per session (only if setting enabled)
  React.useEffect(() => {
    if (!persistChatDraft) {
      clearPendingDraftPersist()
      persistDraftImmediately(currentSessionId, "")
      return
    }

    if (skipNextDraftPersistRef.current) {
      skipNextDraftPersistRef.current = false
      return
    }

    clearPendingDraftPersist()
    const draftSnapshot = message
    const sessionSnapshot = currentSessionId
    draftPersistTimerRef.current = setTimeout(() => {
      draftPersistTimerRef.current = null
      persistDraftImmediately(sessionSnapshot, draftSnapshot)
    }, CHAT_DRAFT_PERSIST_DEBOUNCE_MS)

    return () => {
      clearPendingDraftPersist()
    }
  }, [clearPendingDraftPersist, currentSessionId, message, persistChatDraft, persistDraftImmediately])

  React.useEffect(() => {
    return () => {
      clearPendingDraftPersist()
      if (persistChatDraft) {
        persistDraftImmediately(currentSessionIdForDraftRef.current, messageRef.current)
      }
    }
  }, [clearPendingDraftPersist, persistChatDraft, persistDraftImmediately, messageRef])
}
