import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./computer-plan.txt"
import { checkVisualRouting } from "@/visual/router"
import { Computer } from "@/computer/computer"
import type { ObserveScope } from "@ax-code/computer"
import { renderObservation } from "./render"
import { planWithJudge } from "./plan"

export const ComputerPlanTool = Tool.define("computer_plan", {
  description: DESCRIPTION,
  parameters: z
    .object({
      task: z.string().min(1).describe("The GUI task to plan, in plain language"),
      candidates: z
        .number()
        .int()
        .min(1)
        .max(3)
        .default(2)
        .describe("Number of candidate plans to sample from the model (1 skips judging)"),
      app: z.string().optional().describe("Application name to plan against (e.g. 'TextEdit')"),
      windowId: z.string().optional().describe("Window id to plan against (from a previous observation's window list)"),
    })
    .refine((params) => !(params.app && params.windowId), {
      message: "Provide at most one of app or windowId",
    }),
  async execute(params, ctx) {
    // Check that the current model supports vision input — candidates and the
    // judge run on that same session model
    const routing = await checkVisualRouting({ visionInput: true })
    if (!routing.ok) {
      throw new Error(routing.diagnostic)
    }

    const scope: ObserveScope = params.app
      ? { app: params.app }
      : params.windowId
        ? { windowId: params.windowId }
        : { desktop: true }
    const descriptor = params.app ? `app:${params.app}` : params.windowId ? `window:${params.windowId}` : "desktop"

    await ctx.ask({
      permission: "computer",
      patterns: [`plan:${descriptor}`],
      always: [`plan:${descriptor}`],
      metadata: { scope: descriptor, task: params.task, candidates: params.candidates },
    })

    const observation = await Computer.observe(scope, {
      audit: { sessionID: ctx.sessionID, messageID: ctx.messageID, tool: "computer_plan" },
    })
    const observationText = renderObservation(observation, {
      includeScreenshot: false,
      screenshotName: "computer-plan",
    }).output
    const trajectory = await Computer.trajectory()

    const result = await planWithJudge({
      task: params.task,
      candidates: params.candidates,
      model: routing.model,
      observationText,
      trajectory,
      abort: ctx.abort,
    })

    await Computer.record({ kind: "plan", summary: `plan "${params.task.slice(0, 80)}" → ${result.winner.title}` })

    const lines: string[] = []
    lines.push(
      `Plan for "${params.task}" — winner: "${result.winner.title}" (candidate ${result.winnerIndex + 1} of ${result.candidateCount})`,
    )
    lines.push("")
    result.winner.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`))
    if (result.winner.risks.length > 0) {
      lines.push("", "Risks:")
      for (const risk of result.winner.risks) lines.push(`- ${risk}`)
    }
    lines.push("")
    if (result.judged) {
      lines.push(`Judge rationale: ${result.rationale ?? ""}`)
    } else {
      lines.push("Judging skipped — showing the first successful candidate. Verify each step as you execute it.")
    }
    if (result.losers.length > 0) {
      lines.push("", "Other candidates:")
      for (const title of result.losers) lines.push(`- ${title}`)
    }
    lines.push("", "Execute this plan step-by-step with computer_snapshot and computer_action.")

    return {
      title: `Plan: ${result.winner.title}`,
      output: lines.join("\n"),
      metadata: {
        winner: result.winnerIndex,
        candidateCount: result.candidateCount,
        rationale: result.rationale,
        scope: descriptor,
      },
    }
  },
})
