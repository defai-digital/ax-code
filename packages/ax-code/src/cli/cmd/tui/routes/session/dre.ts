import { SessionDre as SessionDreCore } from "@/session/dre"

export namespace SessionDre {
  export type Summary = SessionDreCore.Summary
  export type Detail = SessionDreCore.Detail

  export type Entry = {
    id: string
    title: string
    description?: string
    footer?: string
    category?: string
  }

  export type TimelineLine = SessionDreCore.TimelineLine

  export function summarize(input: Parameters<typeof SessionDreCore.summarize>[0]) {
    return SessionDreCore.summarize(input)
  }

  export function detail(input: Parameters<typeof SessionDreCore.detail>[0]) {
    return SessionDreCore.detail(input)
  }

  export function merge(detail: Detail, semantic?: Detail["semantic"]) {
    if (semantic === undefined) return detail
    return {
      ...detail,
      semantic,
    } satisfies Detail
  }

  function format(ms: number) {
    const sec = Math.floor(ms / 1000)
    if (sec < 60) return `${sec}s`
    const min = Math.floor(sec / 60)
    return `${min}m ${sec % 60}s`
  }

  export function entries(input: Detail): Entry[] {
    const result = [] as Entry[]

    result.push({
      id: "risk",
      title: `Risk ${input.level.toLowerCase()} (${input.score}/100)`,
      description: input.summary || "minimal change",
      footer: `${input.stats} · ${format(input.duration)} · ${input.tokens.input}/${input.tokens.output} tokens`,
      category: "Overview",
    })

    result.push({
      id: "plan",
      title: input.plan,
      description: input.notes.length > 0 ? input.notes.join(" · ") : "no extra decision notes",
      category: "Overview",
    })

    if (input.semantic) {
      result.push({
        id: "semantic",
        title: input.semantic.headline,
        description: `${input.semantic.files} files · +${input.semantic.additions} / -${input.semantic.deletions}`,
        footer: [input.semantic.risk, ...input.semantic.signals].join(" · "),
        category: "Changes",
      })
    }

    for (const [idx, item] of input.breakdown.entries()) {
      result.push({
        id: `risk:${idx}`,
        title: `${item.label} (+${item.points})`,
        description: item.detail,
        category: "Risk",
      })
    }

    result.push({
      id: "decision",
      title: `Decision ${input.scorecard.total.toFixed(2)}`,
      description: input.decision,
      category: "Score",
    })

    for (const part of input.scorecard.breakdown) {
      result.push({
        id: `score:${part.key}`,
        title: `${part.label} ${part.value.toFixed(2)}`,
        description: part.detail,
        category: "Score",
      })
    }

    for (const [idx, line] of input.drivers.entries()) {
      result.push({
        id: `driver:${idx}`,
        title: line,
        category: "Drivers",
      })
    }

    for (const [idx, route] of input.routes.entries()) {
      result.push({
        id: `route:${idx}`,
        title: `${route.from} → ${route.to}`,
        description: `confidence ${route.confidence.toFixed(2)}`,
        category: "Routing",
      })
    }

    for (const [idx, tool] of input.tools.entries()) {
      result.push({
        id: `tool:${idx}`,
        title: `${idx + 1}. ${tool}`,
        category: "Tools",
      })
    }

    for (const item of input.counts) {
      result.push({
        id: `event:${item.type}`,
        title: item.type,
        description: `${item.count} event${item.count === 1 ? "" : "s"}`,
        category: "Events",
      })
    }

    return result
  }

  export function timeline(graph: Parameters<typeof SessionDreCore.timeline>[0]): TimelineLine[] {
    return SessionDreCore.timeline(graph)
  }

  export function load(sessionID: Parameters<typeof SessionDreCore.load>[0]) {
    return SessionDreCore.load(sessionID)
  }

  export function loadDetail(sessionID: Parameters<typeof SessionDreCore.loadDetail>[0]) {
    return SessionDreCore.loadDetail(sessionID)
  }

  export function loadTimeline(sessionID: Parameters<typeof SessionDreCore.loadTimeline>[0]) {
    return SessionDreCore.loadTimeline(sessionID)
  }
}
