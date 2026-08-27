export const COMPACTION_TOAST = {
  variant: "info" as const,
  message: "Context compacted. Older messages were summarized.",
  duration: 5000,
}

export function compactionToastForActiveSession(input: { compactedSessionID: string; activeSessionID: string }) {
  if (input.compactedSessionID !== input.activeSessionID) return
  return COMPACTION_TOAST
}
