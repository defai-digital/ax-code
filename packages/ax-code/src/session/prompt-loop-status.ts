import { Log } from "../util/log"
import type { SessionID } from "./schema"
import { SessionStatus } from "./status"

const log = Log.create({ service: "session.prompt" })

export async function markPromptLoopBusy(input: {
  sessionID: SessionID
  step: number
  maxSteps: number
  consecutiveErrors: number
}) {
  const now = Date.now()
  await SessionStatus.set(input.sessionID, {
    type: "busy",
    step: input.step,
    maxSteps: input.maxSteps,
    startedAt: now,
    lastActivityAt: now,
    waitState: "llm",
  })
  log.info("loop", {
    command: "session.prompt.loop",
    status: "started",
    step: input.step,
    sessionID: input.sessionID,
    consecutiveErrors: input.consecutiveErrors,
  })
  if (input.step > 0 && input.step % 10 === 0) {
    log.warn("long-running task", {
      command: "session.prompt.loop",
      status: "ok",
      step: input.step,
      sessionID: input.sessionID,
      message: `Agent has been working for ${input.step} steps`,
    })
  }
}
