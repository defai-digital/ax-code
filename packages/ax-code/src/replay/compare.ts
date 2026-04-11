import type { Risk } from "../risk/score"
import type { ReplayEvent } from "./event"
import type { Replay } from "./replay"

export namespace ReplayCompare {
  export type ScoreKey = "correctness" | "safety" | "simplicity" | "validation"
  export type SemanticRisk = "low" | "medium" | "high"

  export type Semantic = {
    primary: string
    risk: SemanticRisk
    headline: string
    files: number
  }

  export type ScorePart = {
    key: ScoreKey
    label: string
    value: number
    detail: string
  }

  export type Scorecard = {
    total: number
    breakdown: ScorePart[]
  }

  export type Route = {
    from: string
    to: string
    confidence: number
  }

  export type View = {
    tools: string[]
    routes: Route[]
    counts: Record<string, number>
    plan: string
    notes: string[]
  }

  export type Delta = {
    toolChainDiffers: boolean
    routeDiffers: boolean
    eventCountDelta: number
  }

  export type Advice = {
    winner: "A" | "B" | "tie"
    confidence: number
    reasons: string[]
  }

  export type Candidate = {
    id: string
    title: string
    risk: Risk.Assessment
    view: View
    deep?: { divergences: Replay.DivergenceInfo[] }
    semantic?: Semantic | null
  }

  export type Ranked = Candidate & {
    decision: Scorecard
    headline: string
  }

  export type Ranking = {
    recommended: Ranked
    reasons: string[]
    confidence: number
    items: Ranked[]
  }

  function clamp(input: number) {
    return Math.max(0, Math.min(1, input))
  }

  function round(input: number) {
    return Number(input.toFixed(2))
  }

  function plural(value: number, unit: string) {
    return `${value} ${unit}${value === 1 ? "" : "s"}`
  }

  function semanticRisk(input?: Semantic | null) {
    if (!input) return 0
    if (input.risk === "high") return 2
    if (input.risk === "medium") return 1
    return 0
  }

  function semanticCost(input?: Semantic | null) {
    if (!input) return 0
    if (input.primary === "rewrite") return 3
    if (input.primary === "dependency" || input.primary === "configuration") return 2
    if (input.primary === "refactor" || input.primary === "optimization") return 1
    return 0
  }

  export function tools(evts: ReplayEvent[]) {
    return evts
      .filter((evt): evt is ReplayEvent & { type: "tool.call" } => evt.type === "tool.call")
      .map((evt) => evt.tool)
  }

  export function routes(evts: ReplayEvent[]) {
    return evts
      .filter((evt): evt is ReplayEvent & { type: "agent.route" } => evt.type === "agent.route")
      .map((evt) => ({ from: evt.fromAgent, to: evt.toAgent, confidence: evt.confidence }))
  }

  export function counts(evts: ReplayEvent[]) {
    const map: Record<string, number> = {}
    for (const evt of evts) map[evt.type] = (map[evt.type] ?? 0) + 1
    return map
  }

  export function delta(a: ReplayEvent[], b: ReplayEvent[]): Delta {
    const ta = tools(a).join(",")
    const tb = tools(b).join(",")
    const ra = routes(a)
      .map((item) => `${item.from}-${item.to}`)
      .join(",")
    const rb = routes(b)
      .map((item) => `${item.from}-${item.to}`)
      .join(",")
    return {
      toolChainDiffers: ta !== tb,
      routeDiffers: ra !== rb,
      eventCountDelta: b.length - a.length,
    }
  }

  export function view(
    evts: ReplayEvent[],
    risk: Risk.Assessment,
    deep?: { divergences: Replay.DivergenceInfo[] },
  ): View {
    const tool = tools(evts)
    const route = routes(evts)
    const set = new Set(tool)
    const read = tool.filter((item) => ["read", "grep", "glob", "ls", "find"].includes(item)).length
    const write = tool.filter((item) => ["apply_patch", "edit", "multiedit", "write"].includes(item)).length

    const head = route.length > 0 ? "delegated " : ""
    const body =
      write === 0
        ? "read-only investigation"
        : set.has("write") && risk.signals.filesChanged > 3
          ? "broad rewrite"
          : risk.signals.filesChanged > 3
            ? "multi-file edit"
            : "incremental edit"
    const tail = read > 0 && read >= write ? "inspect-first " : ""
    const plan = `${head}${tail}${body}`.trim()

    const note = [] as string[]
    if (risk.signals.validationPassed === true) note.push("validation passed")
    if (risk.signals.validationPassed === false) note.push("validation failed")
    if (risk.signals.validationPassed === undefined) note.push("validation not recorded")
    if (risk.signals.toolFailures > 0) note.push(`${risk.signals.toolFailures} tool failures`)
    if (deep && deep.divergences.length > 0) note.push(`${deep.divergences.length} replay divergences`)

    return {
      tools: tool,
      routes: route,
      counts: counts(evts),
      plan,
      notes: note,
    }
  }

  export function score(input: {
    risk: Risk.Assessment
    view: View
    deep?: { divergences: Replay.DivergenceInfo[] }
    semantic?: Semantic | null
  }): Scorecard {
    const fail = input.risk.signals.toolFailures
    const div = input.deep?.divergences.length ?? 0
    const state = input.risk.signals.validationPassed
    const test = state === true ? 1 : state === false ? 0 : 0.45
    const base = state === true ? 0.95 : state === false ? 0.35 : 0.55
    const correctness = round(clamp(base - Math.min(0.3, fail * 0.1) - Math.min(0.24, div * 0.08)))
    const safety = round(clamp(1 - input.risk.score / 100 - semanticRisk(input.semantic) * 0.04))
    const tools = Math.max(input.view.tools.length, input.risk.signals.totalTools)
    const routes = input.view.routes.length
    const simplicity = round(
      clamp(
        1 -
          Math.min(0.45, Math.max(0, input.risk.signals.filesChanged - 1) * 0.08) -
          Math.min(0.25, input.risk.signals.linesChanged / 800) -
          Math.min(0.15, Math.max(0, tools - 2) * 0.05) -
          Math.min(0.15, routes * 0.05) -
          semanticCost(input.semantic) * 0.03,
      ),
    )
    const validation = round(test)
    const total = round(correctness * 0.4 + safety * 0.3 + simplicity * 0.15 + validation * 0.15)
    const status =
      state === true ? "validation passed" : state === false ? "validation failed" : "validation not recorded"
    const change = input.semantic ? ` · ${input.semantic.headline}` : ""

    return {
      total,
      breakdown: [
        {
          key: "correctness",
          label: "Correctness",
          value: correctness,
          detail: `${status}, ${div} divergences, ${fail} tool failures`,
        },
        {
          key: "safety",
          label: "Safety",
          value: safety,
          detail: `risk ${input.risk.score}/100${change}`,
        },
        {
          key: "simplicity",
          label: "Simplicity",
          value: simplicity,
          detail: `${plural(input.risk.signals.filesChanged, "file")}, ${input.risk.signals.linesChanged} lines, ${plural(tools, "tool call")}, ${plural(routes, "route")}${change}`,
        },
        {
          key: "validation",
          label: "Validation",
          value: validation,
          detail: status,
        },
      ],
    }
  }

  export function headline(input: Scorecard, limit = 2) {
    const head = input.breakdown
      .slice(0, limit)
      .map((item) => `${item.key} ${item.value.toFixed(2)}`)
      .join(" · ")
    return head ? `decision ${input.total.toFixed(2)} · ${head}` : `decision ${input.total.toFixed(2)}`
  }

  export function rank(input: Candidate[]): Ranking {
    const items = input
      .map((item) => {
        const decision = score({ risk: item.risk, view: item.view, deep: item.deep, semantic: item.semantic })
        return {
          ...item,
          decision,
          headline: headline(decision),
        }
      })
      .sort((a, b) => {
        if (b.decision.total !== a.decision.total) return b.decision.total - a.decision.total
        if (a.risk.score !== b.risk.score) return a.risk.score - b.risk.score
        if (semanticRisk(a.semantic) !== semanticRisk(b.semantic)) return semanticRisk(a.semantic) - semanticRisk(b.semantic)
        if (semanticCost(a.semantic) !== semanticCost(b.semantic)) return semanticCost(a.semantic) - semanticCost(b.semantic)
        const av = a.risk.signals.validationPassed === true ? 1 : a.risk.signals.validationPassed === false ? -1 : 0
        const bv = b.risk.signals.validationPassed === true ? 1 : b.risk.signals.validationPassed === false ? -1 : 0
        if (bv !== av) return bv - av
        return a.id.localeCompare(b.id)
      })

    if (items.length === 0) throw new Error("no candidates to rank")
    if (items.length === 1) {
      return {
        recommended: items[0],
        reasons: ["only one branch candidate available"],
        confidence: 0.5,
        items,
      }
    }

    const best = items[0]!
    const next = items[1]!
    const advice = advise({
      riskA: best.risk,
      riskB: next.risk,
      viewA: best.view,
      viewB: next.view,
      deepA: best.deep,
      deepB: next.deep,
      semanticA: best.semantic,
      semanticB: next.semantic,
    })

    const recommended = advice.winner === "B" ? next : best

    return {
      recommended,
      reasons: advice.reasons,
      confidence: advice.confidence,
      items: recommended.id === best.id ? items : [recommended, ...items.filter((item) => item.id !== recommended.id)],
    }
  }

  export function advise(input: {
    riskA: Risk.Assessment
    riskB: Risk.Assessment
    viewA?: View
    viewB?: View
    deepA?: { divergences: Replay.DivergenceInfo[] }
    deepB?: { divergences: Replay.DivergenceInfo[] }
    semanticA?: Semantic | null
    semanticB?: Semantic | null
  }): Advice {
    let a = 0
    let b = 0
    const ra = [] as Array<{ pts: number; msg: string }>
    const rb = [] as Array<{ pts: number; msg: string }>

    const vote = (side: "A" | "B", pts: number, msg: string) => {
      if (side === "A") {
        a += pts
        ra.push({ pts, msg })
        return
      }
      b += pts
      rb.push({ pts, msg })
    }

    const testA = input.riskA.signals.validationPassed
    const testB = input.riskB.signals.validationPassed
    if (testA !== testB) {
      if (testA === true) vote("A", 4, "validation passed")
      if (testB === true) vote("B", 4, "validation passed")
      if (testA === false) vote("B", 2, "avoids a failed validation run")
      if (testB === false) vote("A", 2, "avoids a failed validation run")
    }

    const risk = Math.abs(input.riskA.score - input.riskB.score)
    if (risk >= 15) vote(input.riskA.score < input.riskB.score ? "A" : "B", 3, "lower risk score")
    if (risk >= 5 && risk < 15) vote(input.riskA.score < input.riskB.score ? "A" : "B", 2, "lower risk score")

    const fail = Math.abs(input.riskA.signals.toolFailures - input.riskB.signals.toolFailures)
    if (fail > 0)
      vote(input.riskA.signals.toolFailures < input.riskB.signals.toolFailures ? "A" : "B", 2, "fewer tool failures")

    if (input.viewA && input.viewB) {
      const sa = score({ risk: input.riskA, view: input.viewA, deep: input.deepA, semantic: input.semanticA })
      const sb = score({ risk: input.riskB, view: input.viewB, deep: input.deepB, semantic: input.semanticB })
      const gap = Math.abs(sa.total - sb.total)
      if (gap >= 0.2) vote(sa.total > sb.total ? "A" : "B", 3, "higher decision score")
      if (gap >= 0.08 && gap < 0.2) vote(sa.total > sb.total ? "A" : "B", 2, "higher decision score")
    }

    const semanticGap = Math.abs(semanticRisk(input.semanticA) - semanticRisk(input.semanticB))
    if (semanticGap > 0)
      vote(semanticRisk(input.semanticA) < semanticRisk(input.semanticB) ? "A" : "B", semanticGap >= 2 ? 2 : 1, "lower semantic change risk")

    if (input.semanticA?.primary !== input.semanticB?.primary) {
      if (input.semanticA?.primary === "rewrite" && input.semanticB?.primary !== "rewrite") vote("B", 2, "avoids a broad rewrite")
      if (input.semanticB?.primary === "rewrite" && input.semanticA?.primary !== "rewrite") vote("A", 2, "avoids a broad rewrite")
    }

    if (input.deepA && input.deepB) {
      const div = Math.abs(input.deepA.divergences.length - input.deepB.divergences.length)
      if (div > 0)
        vote(
          input.deepA.divergences.length < input.deepB.divergences.length ? "A" : "B",
          div >= 2 ? 2 : 1,
          "fewer replay divergences",
        )
    }

    const file = Math.abs(input.riskA.signals.filesChanged - input.riskB.signals.filesChanged)
    if (file >= 3)
      vote(input.riskA.signals.filesChanged < input.riskB.signals.filesChanged ? "A" : "B", 1, "smaller change surface")

    if (a === b) {
      return {
        winner: "tie",
        confidence: 0.5,
        reasons: ["signals are materially similar"],
      }
    }

    const gap = Math.abs(a - b)
    const base = 0.55 + Math.min(0.35, gap * 0.08)
    return {
      winner: a > b ? "A" : "B",
      confidence: Number(base.toFixed(2)),
      reasons: (a > b ? ra : rb)
        .sort((x, y) => y.pts - x.pts || x.msg.localeCompare(y.msg))
        .map((item) => item.msg)
        .slice(0, 3),
    }
  }
}
