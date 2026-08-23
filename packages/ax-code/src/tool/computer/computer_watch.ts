import crypto from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./computer-watch.txt"
import { checkVisualRouting, sessionModelFromMessages } from "@/visual/router"
import { Computer } from "@/computer/computer"
import type { ComputerObservation, ObserveScope } from "@ax-code/computer"
import { ComputerUseError } from "@ax-code/computer"
import { renderObservation } from "./render"

/** Content signature used for change detection between polls. */
function signatureOf(observation: ComputerObservation): string {
  // Observation epochs intentionally change on every poll. Compare the raw
  // provider identity beneath the single session prefix so freshness tokens
  // do not masquerade as visible UI changes.
  const elements = observation.elements.map(
    (e) => `${e.id.replace(/^e\d+:/, "")}|${e.role ?? ""}|${e.name ?? ""}|${e.value ?? ""}`,
  )
  const screenshotHash = observation.screenshot?.data ? hashData(observation.screenshot.data) : ""
  return `${elements.join("\n")}\n---\n${observation.a11yText ?? ""}\n---\n${screenshotHash}`
}

function hashData(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex")
}

interface WatchChange {
  /** ms since the watch started */
  at: number
  detail: string
}

export const ComputerWatchTool = Tool.define("computer_watch", {
  description: DESCRIPTION,
  parameters: z
    .object({
      app: z.string().optional().describe("Application name to watch (e.g. 'TextEdit')"),
      windowId: z.string().optional().describe("Window id to watch (from a previous observation's window list)"),
      durationMs: z
        .number()
        .int()
        .min(500)
        .max(60_000)
        .default(10_000)
        .describe("How long to watch, in milliseconds (max 60s)"),
      intervalMs: z.number().int().min(200).max(10_000).default(1_000).describe("Polling interval in milliseconds"),
      includeScreenshot: z.boolean().default(true).describe("Attach a screenshot of the final observation"),
    })
    .refine((params) => !(params.app && params.windowId), {
      message: "Provide at most one of app or windowId",
    }),
  async execute(params, ctx) {
    // Check that the session's model supports vision input
    const routing = await checkVisualRouting({ visionInput: true }, { model: sessionModelFromMessages(ctx.messages) })
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
      patterns: [`watch:${descriptor}`],
      always: [`watch:${descriptor}`],
      metadata: { scope: descriptor, durationMs: params.durationMs, intervalMs: params.intervalMs },
    })

    const started = Date.now()
    const changes: WatchChange[] = []
    let polls = 0
    let observation = await Computer.observe(scope, {
      audit: { sessionID: ctx.sessionID, messageID: ctx.messageID, tool: "computer_watch" },
    })
    polls++
    let signature = signatureOf(observation)
    let elementCount = observation.elements.length

    while (Date.now() - started < params.durationMs) {
      const remaining = params.durationMs - (Date.now() - started)
      // node:timers/promises sleep rejects with an AbortError on abort — treat
      // it as a clean stop so the model still gets the partial timeline
      await sleep(Math.min(params.intervalMs, remaining), undefined, { signal: ctx.abort }).catch(() => {})
      if (ctx.abort.aborted) break

      let polled: ComputerObservation
      try {
        polled = await Computer.observe(scope, {
          audit: { sessionID: ctx.sessionID, messageID: ctx.messageID, tool: "computer_watch" },
        })
      } catch (err) {
        // An act committed while this poll was in flight, so the session
        // superseded the observation. Skip the poll; the next interval
        // re-observes the post-action UI.
        if (err instanceof ComputerUseError && err.code === "superseded_observation") continue
        throw err
      }
      observation = polled
      polls++
      const next = signatureOf(observation)
      if (next === signature) continue
      const nextCount = observation.elements.length
      const parts: string[] = []
      if (nextCount !== elementCount) parts.push(`elements ${elementCount} → ${nextCount}`)
      parts.push("screen content changed")
      changes.push({ at: Date.now() - started, detail: parts.join(", ") })
      signature = next
      elementCount = nextCount
    }

    const rendered = await renderObservation(observation, {
      includeScreenshot: params.includeScreenshot,
      screenshotName: "computer-watch",
    })

    const timeline =
      changes.length === 0
        ? "No changes detected."
        : changes.map((change) => `- t+${change.at}ms: ${change.detail}`).join("\n")

    await Computer.record({
      kind: "observe",
      summary: `watch ${descriptor} ${Date.now() - started}ms (${changes.length} changes)`,
    })

    return {
      title: `Watched ${descriptor}: ${changes.length} changes`,
      output: [
        `Watched ${descriptor} for ${Date.now() - started}ms (${polls} polls every ~${params.intervalMs}ms).`,
        "",
        timeline,
        "",
        "Final observation:",
        rendered.output,
      ].join("\n"),
      metadata: {
        scope: descriptor,
        provider: observation.provider,
        changes: changes.length,
        polls,
        aborted: ctx.abort.aborted,
        elementCount: observation.elements.length,
      },
      attachments: rendered.attachments,
    }
  },
})
