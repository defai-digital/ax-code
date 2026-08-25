import { Log } from "../util/log"
import type { SessionID } from "./schema"
import { SessionStatus } from "./status"

const log = Log.create({ service: "session.prompt" })

export async function markPromptLoopBusy(input: {
  sessionID: SessionID
  step: number
  maxSteps: number
  consecutiveErrors: number
  totalModelTurns?: number
  totalModelTurnLimit?: number
  continuations?: number
  continuationLimit?: number | null
}) {
  const now = Date.now()
  await SessionStatus.set(input.sessionID, {
    type: "busy",
    step: input.step,
    maxSteps: input.maxSteps,
    segmentModelTurns: input.step,
    segmentModelTurnLimit: input.maxSteps,
    ...(input.totalModelTurns !== undefined ? { totalModelTurns: input.totalModelTurns } : {}),
    ...(input.totalModelTurnLimit !== undefined ? { totalModelTurnLimit: input.totalModelTurnLimit } : {}),
    ...(input.continuations !== undefined ? { continuations: input.continuations } : {}),
    ...(input.continuationLimit !== undefined ? { continuationLimit: input.continuationLimit } : {}),
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
      totalModelTurns: input.totalModelTurns,
      continuations: input.continuations,
      sessionID: input.sessionID,
      message: `Agent has been working for ${input.step} model turns in the current segment`,
    })
  }
}
