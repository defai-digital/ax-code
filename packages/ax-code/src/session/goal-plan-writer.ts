import { Instance } from "../project/instance"
import { Permission } from "@/permission"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { withTimeout } from "../util/timeout"
import { asRecordOrUndefined } from "../util/record"
import { GoalPlan } from "./goal-plan"
import type { SessionID } from "./schema"
import type { ModelID, ProviderID } from "../provider/schema"

// The writer's turn budget is `steps: 12` with up to 3 auto-continuations
// (48 model turns worst case). Exploration turns run 5–10s each and the final
// plan-drafting/submission turns 20–30s+ on mid-latency providers, so a
// healthy writer needs several minutes. The previous 120s cap only covered
// ~14 fast exploration turns and killed healthy writers mid-submission
// (observed 2026-08-29: cancel landed while submit_goal_plan was executing).
const WRITER_TIMEOUT_MS = 600_000
const WRITER_AGENT = "goal-plan-writer"

export namespace GoalPlanWriter {
  const log = Log.create({ service: "session.goal-plan-writer" })

  export type Input = {
    sessionID: SessionID
    objective: string
    model?: { providerID: ProviderID; modelID: ModelID }
  }

  export type WriteFn = (input: Input) => Promise<string>

  const state = Instance.state(() => ({
    write: defaultWrite as WriteFn,
  }))

  export function setWrite(fn: WriteFn) {
    state().write = fn
  }

  export function resetWrite() {
    state().write = defaultWrite
  }

  export async function write(input: Input) {
    return state().write(input)
  }

  export function stubWrite(objective = "complete the requested work"): WriteFn {
    return async (input) => GoalPlan.render(GoalPlan.sample(input.objective || objective))
  }

  async function defaultWrite(input: Input) {
    const { Session } = await import(".")
    const { SessionPrompt } = await import("./prompt")
    const { Provider } = await import("../provider/provider")

    const model = input.model ?? (await Provider.defaultModel())
    const child = await Session.create({
      parentID: input.sessionID,
      title: "Goal plan writer",
      permission: Permission.fromConfig({
        "*": "deny",
        grep: "allow",
        glob: "allow",
        list: "allow",
        read: "allow",
        codesearch: "allow",
        webfetch: "allow",
        websearch: "allow",
        submit_goal_plan: "allow",
      }),
    })
    try {
      await withTimeout(
        SessionPrompt.prompt({
          sessionID: child.id,
          agent: WRITER_AGENT,
          agentRouting: "preserve",
          model,
          parts: [
            {
              type: "text",
              text: `OBJECTIVE:\n${input.objective}`,
            },
          ],
        }),
        WRITER_TIMEOUT_MS,
        "Goal plan writer timed out",
      )
      const markdown = await extractSubmittedPlan(child.id)
      if (!markdown) {
        throw new GoalPlan.Error(
          "writer",
          "Goal plan writer finished without submit_goal_plan. Resume with /goal resume to retry, or /goal clear to discard.",
        )
      }
      return markdown
    } catch (error) {
      await SessionPrompt.cancel(child.id).catch((cancelError) => {
        log.warn("failed to cancel goal plan writer", { error: toErrorMessage(cancelError) })
      })
      if (error instanceof GoalPlan.Error) throw error
      // The deadline can fire while the writer is winding down after a
      // successful submit_goal_plan (the loop only ends when the model stops
      // calling tools). Honor a completed submission instead of failing the
      // goal over work that already landed.
      const salvaged = await extractSubmittedPlan(child.id).catch(() => undefined)
      if (salvaged) return salvaged
      throw new GoalPlan.Error(
        "writer",
        `Goal plan writer failed: ${toErrorMessage(error)}. The goal is paused — /goal resume retries planning, or /goal clear to discard.`,
      )
    }
  }

  async function extractSubmittedPlan(sessionID: SessionID) {
    const { Session } = await import(".")
    const messages = await Session.messages({ sessionID })
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (message.info.role !== "assistant") continue
      for (const part of message.parts) {
        const record = asRecordOrUndefined(part)
        if (!record || record["type"] !== "tool") continue
        if (record["tool"] !== "submit_goal_plan") continue
        const toolState = asRecordOrUndefined(record["state"])
        if (toolState?.["status"] !== "completed") continue
        const output = toolState["output"]
        if (typeof output === "string" && output.trim()) return output
      }
    }
    return undefined
  }
}
