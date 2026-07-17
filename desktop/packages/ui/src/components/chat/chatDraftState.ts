export const shouldAutoOpenChatDraft = (input: {
  autoOpenDraft: boolean
  currentSessionId: string | null
  draftOpen: boolean
  hasSessionRoute: boolean
}): boolean =>
  input.autoOpenDraft && !input.currentSessionId && !input.draftOpen && !input.hasSessionRoute
