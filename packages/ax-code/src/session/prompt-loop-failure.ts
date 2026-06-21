import { NamedError } from "@ax-code/util/error"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { createStoppedAssistantTextResponse } from "./prompt-assistant-response"
import { textPart } from "./prompt-message-builders"
import type { SessionID } from "./schema"

function unknownError(message: string) {
  return new NamedError.Unknown({ message }).toObject()
}

export async function createSyntheticFailureAssistant(input: {
  sessionID: SessionID
  lastUser: MessageV2.User
  message: string
}) {
  const result = await createStoppedAssistantTextResponse({
    sessionID: input.sessionID,
    parent: input.lastUser,
    text: input.message,
    synthetic: true,
    error: unknownError(input.message),
  })
  return result.info
}

export async function publishPromptFailure(input: {
  sessionID: SessionID
  assistant: MessageV2.Assistant
  message: string
  surfaceAsText?: boolean
}) {
  const error = unknownError(input.message)
  input.assistant.error = error
  if (input.surfaceAsText) {
    // The assistant message produced no visible content (e.g. an empty turn).
    // Persist the stop reason as a synthetic text part so the transcript shows
    // a concrete terminal message rather than an empty assistant bubble.
    await Session.updatePart(
      textPart({
        messageID: input.assistant.id,
        sessionID: input.sessionID,
        text: input.message,
        synthetic: true,
      }),
    )
  }
  await Session.updateMessage(input.assistant)
  Session.publishError({ sessionID: input.sessionID, error })
}
