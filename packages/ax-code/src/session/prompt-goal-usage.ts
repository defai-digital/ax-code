import { Log } from "../util/log"
import { SessionGoal } from "./goal"
import type { MessageV2 } from "./message-v2"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

export async function addPromptGoalUsage(input: {
  sessionID: SessionID
  message: MessageV2.Assistant
}): Promise<SessionGoal.Info | undefined> {
  return SessionGoal.addUsage(input).catch((error) => {
    log.warn("goal usage update failed", {
      command: "session.goal.usage",
      status: "error",
      sessionID: input.sessionID,
      error,
    })
    return undefined
  })
}
