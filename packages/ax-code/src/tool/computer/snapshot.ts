import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./snapshot.txt"
import { wrapUntrustedObservation } from "@/visual/computer/frame"
import { ComputerError, requireComputerHost } from "@/visual/computer/protocol"

export const ComputerSnapshotTool = Tool.define("computer_snapshot", {
  description: DESCRIPTION,
  parameters: z.object({
    target: z
      .union([
        z.object({ type: z.literal("frontmost") }),
        z.object({ type: z.literal("app"), query: z.string().min(1) }),
      ])
      .describe("Window to observe. Default frontmost after the user granted an app."),
    reason: z.string().optional().describe("Why a screenshot is required"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "computer_capture",
      patterns: [params.target.type === "app" ? `app:${params.target.query}` : "app:frontmost"],
      always: params.target.type === "app" ? [`app:${params.target.query}`] : [],
      metadata: { target: params.target, reason: params.reason },
    })

    let frame
    try {
      frame = await requireComputerHost().snapshot({ target: params.target, sessionID: ctx.sessionID })
    } catch (error) {
      if (error instanceof ComputerError) throw new Error(`${error.code}: ${error.message}`)
      throw error
    }

    const summary = [
      `frameID=${frame.frameID}`,
      `app=${frame.app.appID} (${frame.app.displayName})`,
      `window=${frame.window.windowID} ${frame.window.title ?? ""}`.trim(),
      `image=${frame.image.width}x${frame.image.height} ${frame.image.mime}`,
      `elements=${frame.elements.length}`,
      ...frame.elements.map((el) => `- ${el.elementID} ${el.role} ${el.name ?? ""}`.trim()),
    ].join("\n")

    return {
      title: `Observed ${frame.app.displayName}`,
      output: wrapUntrustedObservation(summary),
      metadata: {
        frameID: frame.frameID,
        appID: frame.app.appID,
        elementCount: frame.elements.length,
      },
    }
  },
})
