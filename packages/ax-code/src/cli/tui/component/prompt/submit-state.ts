export type SubmitStage = "creating-session" | "dispatching"

const SUBMIT_ABORT_NAME = "PromptSubmitAbortedError"
const SUBMIT_ABORT_MESSAGE = "Prompt submission cancelled"

export function pendingSubmitStatusText(stage: SubmitStage | undefined) {
  switch (stage) {
    case "creating-session":
      return "Starting..."
    case "dispatching":
      return "Submitting..."
    default:
      return ""
  }
}

export function pendingSubmitKeyIntent(input: { pending: boolean; appExit: boolean; sessionInterrupt: boolean }) {
  if (!input.pending) return "none" as const
  if (input.appExit || input.sessionInterrupt) return "cancel" as const
  return "block" as const
}

export function createSubmitAbortError(message = SUBMIT_ABORT_MESSAGE) {
  const error = new Error(message)
  error.name = SUBMIT_ABORT_NAME
  return error
}

export function isSubmitAbortError(error: unknown) {
  if (!(error instanceof Error)) return false
  return error.name === SUBMIT_ABORT_NAME || error.name === "AbortError" || error.message === SUBMIT_ABORT_MESSAGE
}
