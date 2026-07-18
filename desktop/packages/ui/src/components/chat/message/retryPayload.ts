import type { Message, Part } from "@ax-code/sdk/v2"
import { filterSyntheticParts } from "@/lib/messages/synthetic"

export type AssistantRetryPayload = {
  text: string
  providerID: string
  modelID: string
  agent?: string
  variant?: string
}

const readNonEmptyString = (source: unknown, key: string): string | undefined => {
  const value = (source as Record<string, unknown> | undefined)?.[key]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

// AX Code 1.4.0 moved the user-message variant from top-level `variant` into
// `model.variant`; accept both so retries against older histories keep effort.
const readVariant = (message: unknown): string | undefined => {
  const topLevel = readNonEmptyString(message, "variant")
  if (topLevel) return topLevel
  const model = (message as { model?: unknown } | undefined)?.model
  return readNonEmptyString(model, "variant")
}

const extractUserText = (parts: Part[] | undefined): string => {
  return filterSyntheticParts(parts)
    .filter((part) => part.type === "text")
    .map((part) => {
      const text = (part as { text?: unknown }).text
      return typeof text === "string" ? text : ""
    })
    .filter((text) => text.trim().length > 0)
    .join("\n")
    .trim()
}

/**
 * Build the resend payload for retrying a failed assistant turn: the text of
 * the user message that started the turn, plus the model coordinates to send
 * it with (taken from the user message, falling back to the failed assistant
 * message). Returns null when anything essential is missing so callers can
 * degrade gracefully.
 */
export const buildAssistantRetryPayload = (input: {
  messages: Message[]
  partsByMessage: Record<string, Part[]>
  failedAssistantMessage: Message
}): AssistantRetryPayload | null => {
  const failedIndex = input.messages.findIndex((message) => message.id === input.failedAssistantMessage.id)
  const searchSpace =
    failedIndex > 0 ? input.messages.slice(0, failedIndex) : failedIndex === 0 ? [] : input.messages

  const userMessage = [...searchSpace].reverse().find((message) => message.role === "user")
  if (!userMessage) {
    return null
  }

  const text = extractUserText(input.partsByMessage[userMessage.id])
  if (!text) {
    return null
  }

  const providerID =
    readNonEmptyString(userMessage, "providerID") ?? readNonEmptyString(input.failedAssistantMessage, "providerID")
  const modelID =
    readNonEmptyString(userMessage, "modelID") ?? readNonEmptyString(input.failedAssistantMessage, "modelID")
  if (!providerID || !modelID) {
    return null
  }

  const agent = readNonEmptyString(userMessage, "agent") ?? readNonEmptyString(input.failedAssistantMessage, "agent")
  const variant = readVariant(userMessage) ?? readVariant(input.failedAssistantMessage)
  return {
    text,
    providerID,
    modelID,
    ...(agent ? { agent } : {}),
    ...(variant ? { variant } : {}),
  }
}
