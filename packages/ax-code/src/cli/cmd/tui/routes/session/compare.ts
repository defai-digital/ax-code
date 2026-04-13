import { SessionID } from "@/session/schema"
import { SessionCompare as SessionCompareCore } from "@/session/compare"
import { SessionBranch } from "./branch"

export namespace SessionCompare {
  export type Session = SessionBranch.Session
  export type Result = SessionCompareCore.Result

  export type Entry = {
    id: string
    title: string
    description?: string
    footer?: string
    category?: string
    sessionID?: string
  }

  export function targets(input: {
    currentID: string
    sessions: Session[]
    semantic?: Parameters<typeof SessionBranch.detail>[0]["semantic"]
  }) {
    const detail = SessionBranch.detail(input)
    if (!detail || detail.items.length <= 1) return []

    return detail.items
      .filter((item) => item.id !== input.currentID)
      .map((item) => ({
        id: `target:${item.id}`,
        title: item.title,
        description: [item.semantic?.headline, item.view.plan, item.recommended ? "recommended" : ""].filter(Boolean).join(" · "),
        footer: `${item.headline} · risk ${item.risk.level.toLowerCase()} (${item.risk.score}/100)${item.semantic ? ` · ${item.semantic.risk} change risk` : ""}`,
        category: "Branches",
        sessionID: item.id,
      })) satisfies Entry[]
  }

  export function detail(input: {
    currentID: string
    otherID: string
    sessions: Session[]
    deep?: boolean
    semantic?: Parameters<typeof SessionBranch.detail>[0]["semantic"]
  }) {
    const current = input.sessions.find((item) => item.id === input.currentID)
    const other = input.sessions.find((item) => item.id === input.otherID)
    if (!current || !other) return

    return SessionCompareCore.detail({
      session1: {
        id: SessionID.make(current.id),
        title: current.title,
      },
      session2: {
        id: SessionID.make(other.id),
        title: other.title,
      },
      deep: input.deep,
      semantic1: input.semantic?.[current.id] ?? null,
      semantic2: input.semantic?.[other.id] ?? null,
    })
  }

  export function summary(input: Result) {
    if (input.decision.winner === "tie")
      return `execution compare: ${input.session1.title} and ${input.session2.title} tie`
    const next = input.decision.winner === "A" ? input.session1.title : input.session2.title
    return `execution compare: prefer ${next} (${input.advisory.confidence.toFixed(2)})`
  }

  export function entries(input: Result): Entry[] {
    const result = [] as Entry[]

    result.push({
      id: "summary",
      title: summary(input),
      description: `${input.session1.title} vs ${input.session2.title}`,
      footer: input.decision.reasons.join(" · ") || "signals are materially similar",
      category: "Overview",
    })

    result.push({
      id: "decision",
      title: `Recommendation · ${input.decision.winner === "A" ? input.session1.title : input.decision.winner === "B" ? input.session2.title : "tie"}`,
      description: input.decision.recommendation,
      footer: `confidence ${input.decision.confidence} · ${input.decision.differences.join(" · ")}`,
      category: "Decision",
    })

    for (const item of [
      { label: "A", data: input.decision.session1 },
      { label: "B", data: input.decision.session2 },
    ]) {
      result.push({
        id: `decision:${item.label}`,
        title: `${item.label} strategy · ${item.data.plan}`,
        description: [item.data.change, item.data.validation].filter(Boolean).join(" · "),
        footer: item.data.headline,
        category: "Decision",
      })
    }

    for (const [idx, reason] of input.advisory.reasons.entries()) {
      result.push({
        id: `reason:${idx}`,
        title: reason,
        category: "Reasons",
      })
    }

    for (const item of [
      { label: "A", data: input.session1 },
      { label: "B", data: input.session2 },
    ]) {
      result.push({
        id: `session:${item.label}`,
        title: `${item.label} · ${item.data.title}`,
        description: [item.data.semantic?.headline, item.data.headline, item.data.plan].filter(Boolean).join(" · "),
        footer: `risk ${item.data.risk.level.toLowerCase()} (${item.data.risk.score}/100) · ${item.data.events} events`,
        category: "Sessions",
      })
    }

    const delta = [] as string[]
    if (input.differences.toolChainDiffers) delta.push("tool chain changed")
    if (input.differences.routeDiffers) delta.push("routing changed")
    if (input.differences.eventCountDelta !== 0) {
      delta.push(`${input.differences.eventCountDelta > 0 ? "+" : ""}${input.differences.eventCountDelta} event delta`)
    }
    result.push({
      id: "difference",
      title: delta.join(" · ") || "signals are materially similar",
      category: "Differences",
    })

    if (input.replay) {
      for (const item of [
        { label: "A", data: input.replay.session1 },
        { label: "B", data: input.replay.session2 },
      ]) {
        result.push({
          id: `replay:${item.label}`,
          title: `${item.label} replay · ${item.data.divergences} divergence${item.data.divergences === 1 ? "" : "s"}`,
          description: `${item.data.stepsCompared} steps compared`,
          footer: item.data.reasons.join(" · ") || "no replay divergences",
          category: "Replay",
        })
      }
    }

    return result
  }
}
