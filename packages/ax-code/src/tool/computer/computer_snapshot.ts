import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./computer-snapshot.txt"
import { checkVisualRouting } from "@/visual/router"
import { Computer } from "@/computer/computer"
import { toErrorMessage } from "@/util/error-message"
import { renderObservation, renderTargets } from "./render"
import type { ObserveScope } from "@ax-code/computer"

export const ComputerSnapshotTool = Tool.define("computer_snapshot", {
  description: DESCRIPTION,
  parameters: z
    .object({
      app: z
        .string()
        .optional()
        .describe("Application name to observe (e.g. 'TextEdit'); the OCU backend is app-scoped"),
      windowId: z.string().optional().describe("Window id to observe (from a previous observation's window list)"),
      includeScreenshot: z.boolean().default(true).describe("Attach a screenshot image of the observed scope"),
    })
    .refine((params) => !(params.app && params.windowId), {
      message: "Provide at most one of app or windowId",
    }),
  async execute(params, ctx) {
    // Check that the current model supports vision input
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
      patterns: [`observe:${descriptor}`],
      always: [`observe:${descriptor}`],
      metadata: { scope: descriptor },
    })

    const observation = await Computer.observe(scope, {
      audit: { sessionID: ctx.sessionID, messageID: ctx.messageID, tool: "computer_snapshot" },
    })
    await Computer.record({ kind: "observe", summary: `observe ${descriptor}` })
    const rendered = renderObservation(observation, {
      includeScreenshot: params.includeScreenshot,
      screenshotName: "computer-snapshot",
    })

    // Desktop scope is the entry point: append the app/window inventory so the
    // model can discover valid values for scoped follow-up observations. The
    // observation above already succeeded, so a transient discovery failure
    // (backend hiccup, permission flap) must not discard it — report the
    // observation and note that discovery is unavailable.
    let output = rendered.output
    let targets: { appCount: number; windowCount: number } | undefined
    if (!params.app && !params.windowId) {
      try {
        const discovered = await Computer.listTargets()
        output = [rendered.output, "", renderTargets(discovered)].join("\n")
        targets = { appCount: discovered.apps.length, windowCount: discovered.windows.length }
      } catch (err) {
        output = [rendered.output, "", `(app/window discovery temporarily unavailable: ${toErrorMessage(err)})`].join(
          "\n",
        )
      }
    }

    return {
      title: `Observed ${descriptor}`,
      output,
      metadata: {
        scope: descriptor,
        provider: observation.provider,
        platform: observation.platform,
        elementCount: observation.elements.length,
        ...targets,
      },
      attachments: rendered.attachments,
    }
  },
})
