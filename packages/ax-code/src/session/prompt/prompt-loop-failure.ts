import { NamedError } from "@ax-code/util/error"
import { Session } from ".."
import { MessageV2 } from "../message-v2"
import { createStoppedAssistantTextResponse } from "./prompt-assistant-response"
import { textPart } from "./prompt-message-builders"
import type { SessionID } from "../schema"
import { Log } from "@/util/log"
import { Env } from "@/util/env"

const log = Log.create({ service: "session.prompt-loop-failure" })

function unknownError(message: string) {
  return new NamedError.Unknown({ message }).toObject()
}

/**
 * ADR-259: the identity a StopFailure observation hook sees — error name and
 * code only, redacted at the log boundary and bounded. The failure message
 * itself is deliberately excluded: it can quote provider payloads or tool
 * arguments.
 */
function stopFailureIdentity(error: unknown): { errorName: string; errorCode?: string } {
  let name = "PromptFailure"
  let code: string | undefined
  const codeOf = (value: unknown) =>
    typeof value === "number" || (typeof value === "string" && value.length > 0) ? String(value) : undefined
  if (error instanceof Error) {
    name = error.name || name
    code = codeOf((error as { code?: unknown }).code) ?? codeOf((error as { status?: unknown }).status)
  } else if (error && typeof error === "object") {
    const record = error as { name?: unknown; code?: unknown; status?: unknown }
    if (typeof record.name === "string" && record.name.length > 0) name = record.name
    code = codeOf(record.code) ?? codeOf(record.status)
  }
  return {
    errorName: Env.redactForRecord(name).slice(0, 200),
    ...(code === undefined ? {} : { errorCode: Env.redactForRecord(code).slice(0, 100) }),
  }
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
  // Captured before the overwrite below: callers that already recorded the
  // real provider/runtime error on the assistant keep their identity for the
  // StopFailure hook instead of the generic Unknown wrapper.
  const priorError = input.assistant.error
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
  // ADR-259: observation-only StopFailure hook. Fire-and-forget — a broken
  // or slow hook must never affect the failure path.
  void import("@/hooks/lifecycle")
    .then(({ LifecycleHooks }) =>
      LifecycleHooks.runForWorkspace({
        event: "StopFailure",
        sessionID: input.sessionID,
        args: { sessionID: input.sessionID, ...stopFailureIdentity(priorError) },
      }),
    )
    .catch((error) => log.warn("StopFailure lifecycle hooks failed", { sessionID: input.sessionID, error }))
}
