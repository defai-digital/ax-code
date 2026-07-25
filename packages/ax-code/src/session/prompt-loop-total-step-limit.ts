import { Log } from "../util/log"
import { Session } from "."
import { SessionGoal } from "./goal"
import { totalStepLimitDecision } from "./prompt-autonomous-decisions"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

type PromptLoopTotalStepLimitTransition = { action: "ignore" } | { action: "stop"; reason: "step_limit"; message: string }

type PromptLoopTotalStepLimitGoal = {
  objective: string
  status: string
}

type PromptLoopTotalStepLimitDeps = {
  warn?: (message: string, fields: Record<string, unknown>) => void
  publishError?: (input: { sessionID: SessionID; message: string }) => void
  pauseGoal?: (sessionID: SessionID) => Promise<unknown>
}

export async function handlePromptLoopTotalStepLimit(
  input: {
    sessionID: SessionID
    totalSteps: number
    totalStepLimit: number
    continuations: number
    goal?: PromptLoopTotalStepLimitGoal
  },
  deps: PromptLoopTotalStepLimitDeps = {},
): Promise<PromptLoopTotalStepLimitTransition> {
  const decision = totalStepLimitDecision(input)
  if (decision.action === "ignore") return { action: "ignore" }

  // A goal left "active" past this stop turns the session into a repeating
  // failure loop: every later user prompt finishes its turn, the goal
  // auto-continuation re-fires, and the run burns straight back into this
  // ceiling. Pause the goal so the stop is a resumable checkpoint (mirroring
  // the Super-Long deadline path) and tell the user how to pick it back up.
  let message = decision.message
  let goalPaused = false
  if (input.goal?.status === "active") {
    goalPaused = await (deps.pauseGoal ?? SessionGoal.pause)(input.sessionID).then(
      () => true,
      (error) => {
        ;(deps.warn ?? log.warn)("failed to pause goal at cumulative step ceiling", {
          command: "session.prompt.loop",
          status: "error",
          sessionID: input.sessionID,
          error,
        })
        return false
      },
    )
    message += goalPaused
      ? ` The session goal "${input.goal.objective}" was paused at this ceiling — resume it with /goal resume` +
        ` (raise "session.max_total_steps" first if it needs more headroom).`
      : ` The session goal "${input.goal.objective}" is still active and will resume on the next prompt;` +
        ` pause or clear it (/goal pause, /goal clear) if that is not intended.`
  }

  ;(deps.warn ?? log.warn)("cumulative total step limit reached", {
    command: "session.prompt.loop",
    status: "error",
    errorCode: decision.errorCode,
    totalSteps: input.totalSteps,
    totalStepLimit: input.totalStepLimit,
    sessionID: input.sessionID,
    continuations: input.continuations,
    goalPaused,
  })
  ;(deps.publishError ?? Session.publishError)({
    sessionID: input.sessionID,
    message,
  })
  return { action: "stop", reason: decision.reason, message }
}
