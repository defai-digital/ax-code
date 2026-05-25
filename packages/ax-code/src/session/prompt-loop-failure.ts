import { NamedError } from "@ax-code/util/error"
import { Session } from "."
import { MessageV2 } from "./message-v2"
import { createStoppedAssistantTextResponse } from "./prompt-assistant-response"
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
}) {
  const error = unknownError(input.message)
  input.assistant.error = error
  await Session.updateMessage(input.assistant)
  Session.publishError({ sessionID: input.sessionID, error })
}
