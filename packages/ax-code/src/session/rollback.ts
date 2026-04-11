import z from "zod"
import { ExecutionGraph } from "../graph"
import type { ReplayEvent } from "../replay/event"
import { EventQuery } from "../replay/query"
import { Session } from "."
import { MessageID, PartID, SessionID } from "./schema"
import { SessionRevert } from "./revert"

export namespace SessionRollback {
  export type Message = {
    info: {
      id: string
      role: string
      parentID?: string
    }
    parts: {
      id: string
      type: string
    }[]
  }[]

  export const Point = z
    .object({
      step: z.number(),
      messageID: MessageID.zod,
      partID: PartID.zod,
      duration: z.number().optional(),
      tokens: z
        .object({
          input: z.number(),
          output: z.number(),
        })
        .optional(),
      tools: z.string().array(),
      kinds: z.string().array(),
    })
    .meta({
      ref: "SessionRollbackPoint",
    })
  export type Point = z.output<typeof Point>

  export function resolve(msgs: Message, evts: ReplayEvent[]) {
    const bymsg = new Map<string, number[]>()
    // Use a sequential counter to match the remapped stepIndex
    // in ExecutionGraph.build() which assigns 1, 2, 3, ... instead
    // of using the raw event stepIndex
    let stepCount = 0
    for (const evt of evts) {
      if (evt.type !== "step.start" || !evt.messageID) continue
      stepCount++
      const list = bymsg.get(evt.messageID) ?? []
      list.push(stepCount)
      bymsg.set(evt.messageID, list)
    }

    return msgs.flatMap((msg) => {
      if (msg.info.role !== "assistant") return []
      const list = bymsg.get(msg.info.id) ?? []
      let idx = 0
      return msg.parts.flatMap((part) => {
        if (part.type !== "step-start") return []
        const step = list[idx]
        idx += 1
        if (step == null) return []
        return [
          {
            step,
            messageID: MessageID.make(msg.info.id),
            partID: PartID.make(part.id),
            tools: [],
            kinds: [],
          },
        ] satisfies Point[]
      })
    })
  }

  export function detail(input: { points: Point[]; graph: ExecutionGraph.Graph }) {
    const steps = new Map(
      input.graph.nodes.filter((node) => node.type === "step").map((node) => [node.stepIndex ?? -1, node]),
    )

    return input.points.map((item) => {
      const node = steps.get(item.step)
      const ids = node
        ? input.graph.edges
            .filter((edge) => edge.from === node.id && edge.type === "step_contains")
            .map((edge) => edge.to)
        : []
      const tools = ids
        .map((id) => input.graph.nodes.find((node) => node.id === id))
        .filter((node) => node?.type === "tool_call")
      const labels = tools.map((node) => node!.label)
      const kinds = [...new Set(tools.flatMap((node) => (node?.tool ? [node.tool] : [])))]

      return {
        ...item,
        duration: node?.duration,
        tokens: node?.tokens,
        tools: labels,
        kinds,
      } satisfies Point
    })
  }

  function clean(input: string) {
    return input.trim().toLowerCase()
  }

  export function match(point: Point, tool: string) {
    const query = clean(tool)
    return (
      point.kinds.some((item) => clean(item) === query) ||
      point.tools.some((item) => {
        const label = clean(item)
        return label === query || label.startsWith(`${query}:`)
      })
    )
  }

  export function filter(points: Point[], tool?: string) {
    if (!tool) return points
    return points.filter((point) => match(point, tool))
  }

  export function pick(input: {
    points: Point[]
    step?: number
    tool?: string
  }) {
    if (input.step != null) return input.points.find((point) => point.step === input.step)
    if (!input.tool) return
    return [...input.points].reverse().find((point) => match(point, input.tool!))
  }

  export async function points(sessionID: SessionID) {
    const msgs = await Session.messages({ sessionID })
    return detail({
      points: resolve(msgs, EventQuery.bySession(sessionID)),
      graph: ExecutionGraph.build(sessionID),
    })
  }

  export async function apply(input: SessionRevert.RevertInput) {
    const next = await SessionRevert.revert(input)
    if (next.revert) await SessionRevert.cleanup(next)
    return Session.get(input.sessionID)
  }
}
