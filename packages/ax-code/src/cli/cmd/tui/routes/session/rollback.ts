import { ExecutionGraph } from "@/graph"
import { EventQuery } from "@/replay/query"
import { SessionRollback as SessionRollbackCore } from "@/session/rollback"
import { duration as formatDuration } from "./format"

export namespace SessionRollbackView {
  export type Point = SessionRollbackCore.Point
  export type Message = SessionRollbackCore.Message

  export type Entry = {
    id: string
    title: string
    description?: string
    footer?: string
    category?: string
  }

  export function summary(input: Point[]) {
    if (input.length === 0) return
    if (input.length === 1) return `rollback point: step ${input[0].step}`
    return `rollback points: ${input.length} steps (${input[0].step} → ${input[input.length - 1].step})`
  }

  export function entries(input: Point[]): Entry[] {
    if (input.length === 0) return []

    const out = [] as Entry[]
    out.push({
      id: "summary",
      title: `${input.length} rollback point${input.length === 1 ? "" : "s"}`,
      description: `steps ${input[0].step} → ${input[input.length - 1].step}`,
      footer: input.at(-1)?.tools[0] ?? "No tool calls recorded",
      category: "Overview",
    })

    for (const item of tools(input)) out.push(item)

    for (const point of input) {
      const meta = [
        formatDuration(point.duration),
        point.tokens ? `${point.tokens.input}/${point.tokens.output} tokens` : undefined,
        `${point.tools.length} tool${point.tools.length === 1 ? "" : "s"}`,
      ].filter(Boolean)

      out.push({
        id: `step:${point.step}`,
        title: `Step ${point.step}`,
        description: point.tools[0] ?? "No tool calls recorded",
        footer: meta.join(" · "),
        category: "Rollback",
      })
    }

    return out
  }

  export function find(input: Point[], id: string) {
    if (id.startsWith("tool:")) {
      return SessionRollbackCore.pick({
        points: input,
        tool: id.slice("tool:".length),
      })
    }
    if (!id.startsWith("step:")) return
    const step = Number(id.slice("step:".length))
    if (!Number.isFinite(step)) return
    return SessionRollbackCore.pick({
      points: input,
      step,
    })
  }

  export function promptID(msgs: Message, point: Point) {
    const idx = msgs.findIndex((item) => item.info.id === point.messageID)
    if (idx === -1) return
    const current = msgs[idx]
    if (current?.info.role === "user") return current.info.id
    if (current?.info.role === "assistant" && current.info.parentID) return current.info.parentID
    for (let i = idx; i >= 0; i--) {
      const item = msgs[i]
      if (item?.info.role === "user") return item.info.id
    }
  }

  export function load(sessionID: Parameters<typeof EventQuery.bySession>[0], msgs: Message) {
    return SessionRollbackCore.detail({
      points: SessionRollbackCore.resolve(msgs, EventQuery.bySession(sessionID)),
      graph: ExecutionGraph.build(sessionID),
    })
  }

  export function tools(input: Point[]): Entry[] {
    const out = [] as Entry[]
    const seen = new Set<string>()

    for (const point of [...input].reverse()) {
      for (const kind of [...point.kinds].reverse()) {
        if (seen.has(kind)) continue
        seen.add(kind)
        const meta = [
          `step ${point.step}`,
          formatDuration(point.duration),
          point.tokens ? `${point.tokens.input}/${point.tokens.output} tokens` : undefined,
        ].filter(Boolean)
        const query = kind.toLowerCase()

        out.push({
          id: `tool:${kind}`,
          title: `Latest ${kind}`,
          description:
            point.tools.find((item) => {
              const label = item.toLowerCase()
              return label === query || label.startsWith(`${query}:`)
            }) ??
            point.tools[0] ??
            kind,
          footer: meta.join(" · "),
          category: "Tools",
        })
      }
    }

    return out
  }
}
