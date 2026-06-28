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
  /**
   * Set to true when the assistant already has meaningful text content and
   * adding a duplicate synthetic text part would be confusing. Defaults to
   * false so terminal failures always surface their stop reason unless the
   * caller explicitly opts out.
   */
  suppressText?: boolean
}) {
  const error = unknownError(input.message)
  input.assistant.error = error
  if (!input.suppressText) {
    // Persist the stop reason as a synthetic text part so the transcript
    // shows a concrete terminal message rather than an empty or tool-only
    // assistant bubble that reads as "still working".
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
