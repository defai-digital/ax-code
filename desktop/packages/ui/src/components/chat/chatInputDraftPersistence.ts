// Per-session chat composer draft persistence, backed by localStorage.
// Extracted from ChatInput-impl.tsx — keys and behavior must stay byte-identical.

export const CHAT_DRAFT_PERSIST_DEBOUNCE_MS = 500

// Per-session draft key — preserves in-progress messages across project switches
export const getDraftKey = (sessionId: string | null): string => `openchamber_chat_input_draft_${sessionId ?? "new"}`

// Helper to safely read from localStorage for a given session
export const getStoredDraft = (sessionId: string | null): string => {
  try {
    return localStorage.getItem(getDraftKey(sessionId)) ?? ""
  } catch {
    return ""
  }
}

// Helper to safely write/clear a per-session draft
export const saveStoredDraft = (sessionId: string | null, draft: string): void => {
  try {
    if (draft) {
      localStorage.setItem(getDraftKey(sessionId), draft)
    } else {
      localStorage.removeItem(getDraftKey(sessionId))
    }
  } catch {
    // Ignore localStorage errors
  }
}
