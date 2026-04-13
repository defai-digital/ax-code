import { SessionBranchRank } from "@/session/branch"

export namespace SessionBranch {
  export type Session = SessionBranchRank.SessionInfo
  export type Item = SessionBranchRank.Item
  export type Detail = SessionBranchRank.Detail

  export type Entry = {
    id: string
    title: string
    description?: string
    footer?: string
    category?: string
    sessionID?: string
  }

  export function detail(input: {
    currentID: string
    sessions: Session[]
    semantic?: Parameters<typeof SessionBranchRank.detail>[0]["semantic"]
  }) {
    return SessionBranchRank.detail(input)
  }

  export function summary(input: Detail) {
    const best = input.items.find((item) => item.recommended)
    if (!best) return
    if (best.current) return `branch ranking: current session is recommended (${input.items.length} total)`
    return `branch ranking: prefer ${best.title} (${best.decision.total.toFixed(2)})`
  }

  export function entries(input: Detail): Entry[] {
    const best = input.items.find((item) => item.recommended)
    const out = [] as Entry[]

    if (best) {
      out.push({
        id: `summary:${best.id}`,
        title: `Recommended ${best.title}`,
        description: [best.semantic?.headline, ...input.reasons].filter(Boolean).join(" · ") || "signals are materially similar",
        footer: `confidence ${input.confidence} · ${best.headline}`,
        category: "Overview",
        sessionID: best.id,
      })
    }

    for (const item of input.items) {
      const flag = [item.recommended ? "recommended" : "", item.current ? "current" : ""].filter(Boolean).join(" · ")
      out.push({
        id: item.id,
        title: item.title,
        description: [item.semantic?.headline, item.view.plan, flag].filter(Boolean).join(" · "),
        footer: `${item.headline} · risk ${item.risk.level.toLowerCase()} (${item.risk.score}/100)${item.semantic ? ` · ${item.semantic.risk} change risk` : ""}`,
        category: "Branches",
        sessionID: item.id,
      })
    }

    return out
  }

  export function continueEntries(input: Detail): Entry[] {
    const best = input.items.find((item) => item.recommended)
    if (!best) return []
    return [
      {
        id: `continue:${best.id}`,
        title: best.current ? "Continue current branch" : `Continue with ${best.title}`,
        description: [best.semantic?.headline, best.view.plan, best.current ? "recommended current session" : "recommended"]
          .filter(Boolean)
          .join(" · "),
        footer: `confidence ${input.confidence} · ${best.headline}`,
        category: "Continue",
        sessionID: best.id,
      },
    ]
  }

  export function compareEntries(input: Detail): Entry[] {
    return input.items
      .filter((item) => !item.current)
      .map((item) => ({
        id: `compare:${item.id}`,
        title: `Compare with ${item.title}`,
        description: [item.semantic?.headline, item.view.plan, item.recommended ? "recommended" : ""].filter(Boolean).join(" · "),
        footer: `${item.headline} · risk ${item.risk.level.toLowerCase()} (${item.risk.score}/100)${item.semantic ? ` · ${item.semantic.risk} change risk` : ""}`,
        category: "Compare",
        sessionID: item.id,
      }))
  }
}
