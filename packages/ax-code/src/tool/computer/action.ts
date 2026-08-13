import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./action.txt"
import { wrapUntrustedObservation } from "@/visual/computer/frame"
import { ComputerError, requireComputerHost, type ComputerActionName } from "@/visual/computer/protocol"

const ACTIONS = [
  "launch",
  "focus",
  "click",
  "double_click",
  "type",
  "key",
  "scroll",
  "drag",
  "wait",
] as const satisfies ComputerActionName[]

const COMMIT_CLASSES = [
  "message.send",
  "form.submit",
  "calendar.create",
  "purchase",
  "publish",
  "delete",
  "account.change",
  "permission.change",
] as const

export const ComputerActionTool = Tool.define("computer_action", {
  description: DESCRIPTION,
  parameters: z.object({
    frameID: z.string().min(1).describe("frameID from the latest computer_snapshot"),
    action: z.enum(ACTIONS),
    elementID: z.string().optional().describe("Preferred accessibility element from the latest snapshot"),
    x: z.number().int().nonnegative().optional().describe("Returned-image pixel x"),
    y: z.number().int().nonnegative().optional().describe("Returned-image pixel y"),
    text: z.string().optional(),
    key: z.string().optional(),
    expectedOutcome: z.string().optional(),
    commitClass: z.enum(COMMIT_CLASSES).optional(),
    routeReason: z
      .enum(["connector_unavailable", "connector_failed", "native_only", "visual_verification"])
      .optional(),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "computer_input",
      patterns: [`frame:${params.frameID}`],
      always: [],
      metadata: { action: params.action, elementID: params.elementID },
    })
    if (params.commitClass) {
      await ctx.ask({
        permission: "computer_commit",
        patterns: [`action:${params.commitClass}`],
        always: [],
        metadata: { commitClass: params.commitClass },
      })
    }

    let frame
    try {
      frame = await requireComputerHost().act({
        request: {
          frameID: params.frameID,
          action: params.action,
          elementID: params.elementID,
          x: params.x,
          y: params.y,
          text: params.text,
          key: params.key,
          expectedOutcome: params.expectedOutcome,
          commitClass: params.commitClass,
          routeReason: params.routeReason,
        },
        sessionID: ctx.sessionID,
      })
    } catch (error) {
      if (error instanceof ComputerError) throw new Error(`${error.code}: ${error.message}`)
      throw error
    }

    const summary = [
      `acted=${params.action}`,
      `consumed=${params.frameID}`,
      `frameID=${frame.frameID}`,
      `app=${frame.app.appID}`,
      `elements=${frame.elements.length}`,
    ].join("\n")

    return {
      title: `${params.action} → ${frame.app.displayName}`,
      output: wrapUntrustedObservation(summary),
      metadata: {
        consumedFrameID: params.frameID,
        frameID: frame.frameID,
        action: params.action,
      },
    }
  },
})
