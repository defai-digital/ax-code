import z from "zod"
import { Tool } from "../tool"
import DESCRIPTION from "./computer-action.txt"
import { checkVisualRouting } from "@/visual/router"
import { Computer } from "@/computer/computer"
import { ground } from "@/computer/ground"
import { Config } from "@/config/config"
import { ComputerUseError } from "@ax-code/computer"
import { toErrorMessage } from "@/util/error-message"
import type { ComputerAction, ComputerTarget } from "@ax-code/computer"
import { renderObservation, renderTrajectory } from "./render"

const target = z
  .union([
    z.string().min(1).describe("Element id from the latest computer_snapshot (e.g. 'e1:3')"),
    z.object({ x: z.number(), y: z.number() }).describe("Screenshot pixel coordinates from the latest observation"),
    z
      .object({ describe: z.string().min(1) })
      .describe(
        "Natural-language description of the target element; resolved to coordinates by the configured grounder model",
      ),
  ])
  .describe("Element id, {x,y} point, or {describe} natural-language target to act on")

async function resolveTarget(input: z.infer<typeof target>): Promise<ComputerTarget> {
  if (typeof input === "string") return { kind: "element", id: input }
  if ("describe" in input) {
    const grounder = (await Config.get()).computer?.grounder
    if (!grounder?.model) {
      throw new Error(
        'computer.grounder is not configured — set computer.grounder.model (e.g. a UI-TARS vision endpoint, "provider/model") to enable natural-language targets, or use element ids from computer_snapshot instead',
      )
    }
    const observation = await Computer.lastObservation()
    if (!observation?.screenshot) {
      throw new Error(
        "No observation with a screenshot is available for grounding. Call computer_snapshot first, then retry the describe target.",
      )
    }
    const point = await ground({ image: observation.screenshot, description: input.describe })
    return { kind: "point", x: point.x, y: point.y }
  }
  return { kind: "point", x: input.x, y: input.y }
}

function describeTarget(t: z.infer<typeof target>): string {
  if (typeof t === "string") return `element ${t}`
  if ("describe" in t) return `describe:"${t.describe}"`
  return `(${t.x},${t.y})`
}

function summarize(params: z.infer<typeof parameters>): string {
  switch (params.type) {
    case "click":
      return `click ${describeTarget(params.target)}`
    case "type":
      return `type "${params.text}"`
    case "keypress":
      return `keypress ${params.keys.join("+")}`
    case "scroll":
      return `scroll ${params.direction}${params.target ? ` at ${describeTarget(params.target)}` : ""}`
    case "drag":
      return `drag ${describeTarget(params.from)} -> ${describeTarget(params.to)}`
    case "set_value":
      return `set_value ${describeTarget(params.target)}`
    case "activate_window":
      return `activate_window ${params.windowId}`
    case "launch_app":
      return `launch_app ${params.app}`
  }
}

async function translate(params: z.infer<typeof parameters>): Promise<ComputerAction> {
  switch (params.type) {
    case "click":
      return {
        type: "click",
        target: await resolveTarget(params.target),
        button: params.button,
        count: params.count,
      }
    case "type":
      return { type: "type", text: params.text }
    case "keypress":
      return { type: "keypress", keys: params.keys }
    case "scroll":
      return {
        type: "scroll",
        target: params.target ? await resolveTarget(params.target) : undefined,
        direction: params.direction,
        amount: params.amount,
      }
    case "drag":
      return { type: "drag", from: await resolveTarget(params.from), to: await resolveTarget(params.to) }
    case "set_value":
      return { type: "set_value", target: await resolveTarget(params.target), value: params.value }
    case "activate_window":
      return { type: "activate_window", windowId: params.windowId }
    case "launch_app":
      return { type: "launch_app", app: params.app }
  }
}

const parameters = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    target,
    button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button (default left)"),
    count: z.number().int().positive().optional().describe("Click count (e.g. 2 for double-click)"),
  }),
  z.object({
    type: z.literal("type"),
    text: z.string().describe("Text to type into the focused element"),
  }),
  z.object({
    type: z.literal("keypress"),
    keys: z.array(z.string()).min(1).describe("Keys or combination, e.g. ['cmd','s'] or ['return']"),
  }),
  z.object({
    type: z.literal("scroll"),
    target: target.optional(),
    direction: z.enum(["up", "down", "left", "right"]),
    amount: z.number().optional().describe("Scroll amount in pixels"),
  }),
  z.object({
    type: z.literal("drag"),
    from: target.describe("Drag start element or point"),
    to: target.describe("Drag end element or point"),
  }),
  z.object({
    type: z.literal("set_value"),
    target,
    value: z.string().describe("Value to set on the element"),
  }),
  z.object({
    type: z.literal("activate_window"),
    windowId: z.string().describe("Window id from a previous observation"),
  }),
  z.object({
    type: z.literal("launch_app"),
    app: z.string().describe("Application name to launch or focus"),
  }),
])

export const ComputerActionTool = Tool.define("computer_action", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    // Check that the current model supports vision input
    const routing = await checkVisualRouting({ visionInput: true })
    if (!routing.ok) {
      throw new Error(routing.diagnostic)
    }

    const action = await translate(params)
    const summary = summarize(params)

    // Permission pattern is scope-based (app/window/desktop the action lands
    // on) so durable "always" grants survive across snapshots; the full action
    // summary stays in the title/output and the translated action in metadata.
    const label = await Computer.scopeLabel(action)
    const pattern = label ? `${params.type}:${label}` : params.type
    await ctx.ask({
      permission: "computer",
      patterns: [pattern],
      always: label ? [pattern, `${params.type}:*`] : [pattern],
      metadata: { action },
    })

    let result
    try {
      result = await Computer.act(action, {
        audit: { sessionID: ctx.sessionID, messageID: ctx.messageID, tool: "computer_action" },
      })
    } catch (err) {
      if (err instanceof ComputerUseError && err.code === "stale_target") {
        throw new Error(
          `${err.message}\nCall computer_snapshot again to get fresh element ids, then retry the action with the new ids.`,
        )
      }
      throw err
    }

    // Verify-after-act: re-observe the same scope so the model can check the
    // outcome against a fresh screenshot and element list. The action already
    // happened at this point, so a failed re-observation must not mask its
    // result — report the outcome and note that verification is unavailable.
    let observation: Awaited<ReturnType<typeof Computer.reobserve>> | undefined
    let rendered: ReturnType<typeof renderObservation> | undefined
    let reobserveError: string | undefined
    try {
      observation = await Computer.reobserve({
        audit: { sessionID: ctx.sessionID, messageID: ctx.messageID, tool: "computer_action" },
      })
      rendered = renderObservation(observation, {
        includeScreenshot: true,
        screenshotName: "computer-action",
      })
    } catch (err) {
      reobserveError = toErrorMessage(err)
    }

    const header = result.ok
      ? `${summary}: ok`
      : `${summary}: REFUSED by ${result.provider}${result.refusal ? ` (${result.refusal})` : ""}${result.detail ? ` — ${result.detail}` : ""}. Do not retry the same action blindly.`

    const body = rendered
      ? `Fresh observation after the action:\n${rendered.output}`
      : `Re-observation failed (${reobserveError}), so the outcome is unverified. Call computer_snapshot to check the current state before acting again.`

    // Record the step and show recent history: the reflection aid keeps the
    // model from repeating failed actions, and the same entries are the raw
    // material for behavior-narrative judging.
    await Computer.record({ kind: "act", summary, ok: result.ok, detail: result.refusal })
    const trajectory = renderTrajectory(await Computer.trajectory())

    return {
      title: summary,
      output: `${header}\n\n${body}\n\nRecent trajectory:\n${trajectory}`,
      metadata: {
        action: result.action,
        provider: result.provider,
        ok: result.ok,
        refusal: result.refusal,
        elementCount: observation?.elements.length,
        reobserveError,
      },
      attachments: rendered?.attachments,
    }
  },
})
