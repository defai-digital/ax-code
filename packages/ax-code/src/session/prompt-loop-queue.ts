import { Log } from "../util/log"
import type { MessageV2 } from "./message-v2"
import type { PromptLoopEndReason } from "./prompt-loop-recording"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

export function finishPromptLoopQueue(input: {
  sessionID: SessionID
  reason: PromptLoopEndReason
  queuedCallbacks: (sessionID: SessionID) => unknown[]
  markIdle: (sessionID: SessionID) => void
  cancel: (sessionID: SessionID) => Promise<unknown>
  resumeLoop: (input: { sessionID: SessionID; resume_existing: true }) => Promise<MessageV2.WithParts>
}): void | Promise<void> {
  const callbacks = input.queuedCallbacks(input.sessionID)
  if (callbacks.length === 0) {
    return input.cancel(input.sessionID).then(() => undefined)
  }
  // Queued prompts already have durable user messages. Cancelling them when
  // the preceding turn ended with an error rejects the caller while leaving
  // those messages permanently unanswered. Resume a fresh loop whenever
  // callbacks exist, regardless of how the previous turn ended.
  input.markIdle(input.sessionID)
  input.resumeLoop({ sessionID: input.sessionID, resume_existing: true }).catch(async (error) => {
    log.error("session loop failed to resume for queued messages", {
      command: "session.prompt.loop",
      status: "error",
      sessionID: input.sessionID,
      error,
    })
    try {
      await input.cancel(input.sessionID)
    } catch (cancelError) {
      log.error("cancel also failed after resume error", {
        command: "session.prompt.loop",
        status: "error",
        sessionID: input.sessionID,
        error: cancelError,
      })
    }
  })
}
