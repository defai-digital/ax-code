/** No sensitive input leaves this guard; only the blocked boolean is exposed. */
export function tuiMcpBlocked(input: {
  promptMounted: boolean
  draft: string
  parts: number
  modal: boolean
  busy: boolean
  pending: boolean
}) {
  return !input.promptMounted || input.draft.length > 0 || input.parts > 0 || input.modal || input.busy || input.pending
}
