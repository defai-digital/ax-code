/**
 * Ensemble outcome memory (ADR-049 Phase 3).
 * Pure ranking helpers + optional file-backed store for provider/model wins.
 */

import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"

export namespace ModeMemory {
  const log = Log.create({ service: "mode.memory" })

  export type TaskClass =
    | "review"
    | "design"
    | "implement"
    | "debug"
    | "security"
    | "general"

  export type Outcome = {
    taskClass: TaskClass
    providerID: string
    modelID: string
    /** win | place | fail | participate */
    result: "win" | "place" | "fail" | "participate"
    at: number
  }

  export type Stats = {
    providerID: string
    modelID: string
    wins: number
    places: number
    fails: number
    participates: number
    score: number
  }

  export type Store = {
    version: 1
    outcomes: Outcome[]
  }

  const MAX_OUTCOMES = 2000

  export function classifyTask(text: string): TaskClass {
    const t = text.toLowerCase()
    if (/\b(secur|vuln|cve|auth|xss|inject)/i.test(t)) return "security"
    if (/\b(design|architect|trade-?off|should we)\b/i.test(t)) return "design"
    if (/\b(review|pr\b|code quality|lgtm)\b/i.test(t)) return "review"
    if (/\b(bug|debug|crash|failing|stack trace)\b/i.test(t)) return "debug"
    if (/\b(implement|fix|refactor|write|build)\b/i.test(t)) return "implement"
    return "general"
  }

  export function scoreOutcome(result: Outcome["result"]): number {
    switch (result) {
      case "win":
        return 3
      case "place":
        return 1
      case "participate":
        return 0
      case "fail":
        return -1
    }
  }

  export function aggregateStats(
    outcomes: readonly Outcome[],
    taskClass?: TaskClass,
  ): Stats[] {
    const filtered = taskClass ? outcomes.filter((o) => o.taskClass === taskClass) : [...outcomes]
    const map = new Map<string, Stats>()
    for (const o of filtered) {
      const key = `${o.providerID}/${o.modelID}`
      let s = map.get(key)
      if (!s) {
        s = {
          providerID: o.providerID,
          modelID: o.modelID,
          wins: 0,
          places: 0,
          fails: 0,
          participates: 0,
          score: 0,
        }
        map.set(key, s)
      }
      if (o.result === "win") s.wins++
      else if (o.result === "place") s.places++
      else if (o.result === "fail") s.fails++
      else s.participates++
      s.score += scoreOutcome(o.result)
    }
    return [...map.values()].sort((a, b) => b.score - a.score || b.wins - a.wins)
  }

  /**
   * Re-order candidates using historical scores while preserving diversity preference.
   * Does not drop candidates; only soft-sorts.
   */
  export function biasByMemory<T extends { providerID: string; modelID?: string; id?: string }>(
    candidates: readonly T[],
    stats: readonly Stats[],
  ): T[] {
    const scoreOf = (c: T) => {
      const modelID = c.modelID ?? ""
      const hit = stats.find((s) => s.providerID === c.providerID && (modelID === "" || s.modelID === modelID))
      return hit?.score ?? 0
    }
    return [...candidates].sort((a, b) => scoreOf(b) - scoreOf(a))
  }

  function storePath() {
    return path.join(Global.Path.state, "mode-ensemble-memory.json")
  }

  export async function load(): Promise<Store> {
    try {
      const raw = await fs.readFile(storePath(), "utf8")
      const parsed = JSON.parse(raw) as Store
      if (parsed?.version !== 1 || !Array.isArray(parsed.outcomes)) {
        return { version: 1, outcomes: [] }
      }
      return parsed
    } catch {
      return { version: 1, outcomes: [] }
    }
  }

  export async function append(outcomes: readonly Outcome[]): Promise<void> {
    if (!outcomes.length) return
    const current = await load()
    const next: Store = {
      version: 1,
      outcomes: [...current.outcomes, ...outcomes].slice(-MAX_OUTCOMES),
    }
    try {
      await fs.mkdir(path.dirname(storePath()), { recursive: true })
      await fs.writeFile(storePath(), JSON.stringify(next, null, 2), "utf8")
    } catch (error) {
      log.warn("mode memory write failed", { error })
    }
  }

  export async function recordArenaRanking(input: {
    task: string
    rankedIds: string[] // provider/model
    failedIds?: string[]
  }): Promise<void> {
    const taskClass = classifyTask(input.task)
    const at = Date.now()
    const outcomes: Outcome[] = []
    input.rankedIds.forEach((id, index) => {
      const [providerID, ...rest] = id.split("/")
      const modelID = rest.join("/") || "unknown"
      if (!providerID) return
      const result: Outcome["result"] = index === 0 ? "win" : index === 1 ? "place" : "participate"
      outcomes.push({ taskClass, providerID, modelID, result, at })
    })
    for (const id of input.failedIds ?? []) {
      const [providerID, ...rest] = id.split("/")
      const modelID = rest.join("/") || "unknown"
      if (!providerID) continue
      outcomes.push({ taskClass, providerID, modelID, result: "fail", at })
    }
    await append(outcomes)
  }

  export async function recordCouncilParticipation(input: {
    question: string
    memberIds: string[]
    successfulIds: string[]
  }): Promise<void> {
    const taskClass = classifyTask(input.question)
    const at = Date.now()
    const success = new Set(input.successfulIds)
    const outcomes: Outcome[] = input.memberIds.map((id) => {
      const [providerID, ...rest] = id.split("/")
      return {
        taskClass,
        providerID: providerID || "unknown",
        modelID: rest.join("/") || "unknown",
        result: success.has(id) ? ("participate" as const) : ("fail" as const),
        at,
      }
    })
    await append(outcomes)
  }
}
