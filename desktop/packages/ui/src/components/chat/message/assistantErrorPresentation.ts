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
    return {
      text: "This attempt did not complete. AX Code is continuing the same request automatically.",
      variant: "info",
    }
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
  if (detail.trim().toLowerCase() === "aborted") {
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
