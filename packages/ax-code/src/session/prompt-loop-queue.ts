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
  // Starts the next queued/waiting-for-idle task-queue item for this session
  // (followups included) once it truly goes idle. Optional so callers outside
  // the primary session prompt path (if any) keep the old cancel-only
  // behavior instead of silently no-op-ing on a missing dependency.
  drainFollowups?: (sessionID: SessionID) => Promise<unknown>
}): void | Promise<void> {
  const callbacks = input.queuedCallbacks(input.sessionID)
  if (callbacks.length === 0) {
    return input.cancel(input.sessionID).then(async () => {
      // ADR-106 D5: normal completion drains one ordered successor, but an
      // explicit abort already paused pending followups before the loop even
      // observed its abort signal (see SessionPrompt.cancel). Starting one
      // here on the "aborted" reason would race that pause and resume work
      // the user just asked to stop.
      if (input.reason === "aborted" || !input.drainFollowups) return
      await input.drainFollowups(input.sessionID).catch((error) => {
        log.warn("failed to drain waiting follow-ups after synchronous session idle", {
          sessionID: input.sessionID,
          error,
        })
      })
    })
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
