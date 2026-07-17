import { isLikelyProviderAuthFailure, PROVIDER_AUTH_FAILURE_MESSAGE } from "@/lib/messages/providerAuthError"

type AssistantErrorInfo = {
  data?: { message?: unknown }
  message?: unknown
  name?: unknown
}

export type AssistantErrorPresentation = {
  text: string
  variant: "error" | "info"
}

const isAbortError = (errorName: string | undefined, detail: string): boolean => {
  if (errorName === "AbortError") return true

  const normalized = detail.trim().toLowerCase()
  return (
    normalized === "aborted" ||
    normalized === "this operation was aborted" ||
    normalized === "the operation was aborted"
  )
}

export const getAssistantErrorPresentation = (input: {
  isUser: boolean
  error: unknown
  isLastAssistantInTurn: boolean
}): AssistantErrorPresentation | undefined => {
  if (input.isUser || !input.error || typeof input.error !== "object") {
    return undefined
  }

  const errorInfo = input.error as AssistantErrorInfo
  const dataMessage = typeof errorInfo.data?.message === "string" ? errorInfo.data.message : undefined
  const errorMessage = typeof errorInfo.message === "string" ? errorInfo.message : undefined
  const errorName = typeof errorInfo.name === "string" ? errorInfo.name : undefined
  const detail = dataMessage || errorMessage || errorName
  if (!detail) {
    return undefined
  }

  if (!input.isLastAssistantInTurn) {
    // A later assistant message in the same turn means recovery succeeded.
    // Do not leave the failed transport attempt visible to the customer.
    return undefined
  }

  if (errorName === "SessionRetry") {
    return {
      text: `AX Code failed to send a message. Retry attempt info: \n\`${detail}\``,
      variant: "info",
    }
  }
  if (isLikelyProviderAuthFailure(detail)) {
    return {
      text: PROVIDER_AUTH_FAILURE_MESSAGE,
      variant: "error",
    }
  }
  if (isAbortError(errorName, detail)) {
    return {
      text: "The running turn was stopped before AX Code could send the next message.",
      variant: "info",
    }
  }
  if (errorName === "AutonomousLimitExceededError" || detail.includes("AutonomousLimitExceededError")) {
    return {
      text: "Autonomous mode reached its built-in safety limit for a single run and stopped. Any changes made so far have been kept. To keep going, send a follow-up message (for example, \"continue\") and AX Code will resume from where it left off.",
      variant: "info",
    }
  }
  return {
    text: `AX Code failed to send message with error:\n\`${detail}\``,
    variant: "error",
  }
}
