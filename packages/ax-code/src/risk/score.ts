import { existsSync, readFileSync } from "fs"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"
import { EventQuery } from "../replay/query"
import { Snapshot } from "../snapshot"
import type { SessionID } from "../session/schema"

const log = Log.create({ service: "risk" })

export namespace Risk {
  export type Level = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"

  export type Signals = {
    filesChanged: number
    linesChanged: number
    testCoverage: number
    apiEndpointsAffected: number
    crossModule: boolean
    securityRelated: boolean
    validationPassed: boolean | undefined
    toolFailures: number
    totalTools: number
  }

  export type Assessment = {
    level: Level
    score: number
    signals: Signals
    summary: string
    breakdown: Factor[]
  }

  export type Factor = {
    kind: "files" | "lines" | "tests" | "api" | "module" | "security" | "validation" | "tools"
    label: string
    points: number
    detail: string
  }

  const SECURITY_PATTERNS = [
    /auth/i,
    /password/i,
    /secret/i,
    /token/i,
    /credential/i,
    /encrypt/i,
    /decrypt/i,
    /\.env/,
    /\.pem$/,
    /\.key$/,
    /permission/i,
    /oauth/i,
    /session/i,
    /cookie/i,
  ]

  function isSecurityRelated(files: string[]): boolean {
    return files.some((f) => SECURITY_PATTERNS.some((p) => p.test(f)))
  }

  function isCrossModule(files: string[]): boolean {
    const dirs = new Set(files.map((f) => f.split("/").slice(0, 2).join("/")))
    return dirs.size > 2
  }

  function api(files: string[]) {
    return new Set(
      files.filter(
        (file) => file.includes("/src/server/routes/") || file.includes("/server/routes/") || file.includes("/api/"),
      ),
    ).size
  }

  function patch(input: string) {
    let add = 0
    let del = 0
    for (const line of input.split("\n")) {
      if (line.startsWith("+++")) continue
      if (line.startsWith("---")) continue
      if (line.startsWith("+")) {
        add++
        continue
      }
      if (line.startsWith("-")) del++
    }
    return { add, del }
  }

  function file(sessionID: SessionID) {
    return path.join(Global.Path.data, "storage", "session_diff", `${sessionID}.json`)
  }

  function diffs(sessionID: SessionID) {
    const next = file(sessionID)
    if (!existsSync(next)) return
    try {
      const text = readFileSync(next, "utf-8")
      const parsed = Snapshot.FileDiff.array().safeParse(JSON.parse(text))
      if (parsed.success) return parsed.data
      log.warn("risk diff parse failed", { sessionID, error: parsed.error.message })
      return
    } catch (err) {
      log.warn("risk diff read failed", { sessionID, err })
      return
    }
  }

  export function assess(signals: Signals): Assessment {
    let score = 0
    const breakdown = [] as Factor[]
    const push = (kind: Factor["kind"], label: string, points: number, detail: string) => {
      if (points <= 0) return
      score += points
      breakdown.push({ kind, label, points, detail })
    }

    push(
      "files",
      "File churn",
      signals.filesChanged > 10 ? 30 : signals.filesChanged > 5 ? 20 : signals.filesChanged > 1 ? 10 : 0,
      `${signals.filesChanged} files changed`,
    )

    push(
      "lines",
      "Code churn",
      signals.linesChanged > 500 ? 20 : signals.linesChanged > 100 ? 10 : 0,
      `${signals.linesChanged} lines changed`,
    )

    push(
      "tests",
      "Validation coverage",
      signals.testCoverage === 0 && signals.filesChanged > 0 ? 25 : signals.testCoverage < 0.5 ? 15 : 0,
      signals.testCoverage === 0 ? "no validation run recorded" : `validation confidence ${signals.testCoverage}`,
    )

    push(
      "api",
      "API surface",
      signals.apiEndpointsAffected > 0 ? 15 : 0,
      `${signals.apiEndpointsAffected} route files affected`,
    )

    push("module", "Cross-module scope", signals.crossModule ? 10 : 0, "changes span multiple top-level areas")

    push("security", "Security-sensitive area", signals.securityRelated ? 15 : 0, "security-related files touched")

    push(
      "validation",
      "Validation result",
      signals.validationPassed === false ? 20 : 0,
      "validation output reported failure",
    )

    push(
      "tools",
      "Tool stability",
      signals.toolFailures > 0 ? 10 : 0,
      `${signals.toolFailures}/${signals.totalTools} tool calls failed`,
    )

    score = Math.min(score, 100)

    const level: Level = score >= 70 ? "CRITICAL" : score >= 50 ? "HIGH" : score >= 25 ? "MEDIUM" : "LOW"

    const parts: string[] = []
    if (signals.filesChanged > 0) parts.push(`${signals.filesChanged} files changed`)
    if (signals.testCoverage === 0) parts.push("no test coverage")
    if (signals.securityRelated) parts.push("security-related files")
    if (signals.crossModule) parts.push("cross-module change")
    if (signals.apiEndpointsAffected > 0) parts.push(`${signals.apiEndpointsAffected} API endpoints`)
    if (signals.validationPassed === false) parts.push("validation failed")
    if (signals.toolFailures > 0) parts.push(`${signals.toolFailures} tool failures`)

    return {
      level,
      score,
      signals,
      summary: parts.length > 0 ? parts.join(", ") : "minimal change",
      breakdown,
    }
  }

  export function fromSession(sessionID: SessionID): Assessment {
    const events = EventQuery.bySession(sessionID)
    const diff = diffs(sessionID)

    const files = new Set<string>()
    let additions = 0
    let deletions = 0
    let toolFailures = 0
    let totalTools = 0
    let validationPassed: boolean | undefined
    for (const event of events) {
      const e = event as Record<string, unknown>

      if (e.type === "tool.result") {
        totalTools++
        if (e.status === "error") toolFailures++

        // Check validation results
        const tool = e.tool as string
        if (tool === "bash") {
          const output = (e.output as string) ?? ""
          const isTest = /\b(test|jest|vitest|mocha|bun test)\b/i.test(output)
          if (isTest) {
            const failed = /\b(fail|error|FAIL)\b/.test(output)
            if (validationPassed === undefined) validationPassed = !failed
            else if (failed) validationPassed = false
          }
        }
      }

      if (e.type === "tool.call") {
        const tool = e.tool as string
        const input = (e.input as Record<string, unknown>) ?? {}

        if (tool === "edit" || tool === "multiedit" || tool === "write") {
          const fp = (input.filePath ?? input.file_path ?? "") as string
          if (fp) files.add(fp)
        }

        if (tool === "apply_patch") {
          const text = (input.patch ?? "") as string
          const list = [
            ...text.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm),
            ...text.matchAll(/^[+-]{3}\s+[ab]\/(.+)$/gm),
          ]
          for (const item of list) {
            const file = item[1]?.replace(/^[ab]\//, "")
            if (file && file !== "/dev/null") files.add(file)
          }
          const stat = patch(text)
          additions += stat.add
          deletions += stat.del
        }
      }

      if (e.type !== "step.finish") continue
      if (diff) continue
      const tokens = e.tokens as Record<string, number> | undefined
      if (tokens) additions += tokens.output ?? 0
    }

    if (diff) {
      for (const item of diff) {
        files.add(item.file)
        additions += item.additions
        deletions += item.deletions
      }
    }

    const fileList = [...files]
    const linesChanged = additions + deletions

    return assess({
      filesChanged: fileList.length,
      linesChanged,
      testCoverage: validationPassed === undefined ? 0 : validationPassed ? 1 : 0,
      apiEndpointsAffected: api(fileList),
      crossModule: isCrossModule(fileList),
      securityRelated: isSecurityRelated(fileList),
      validationPassed,
      toolFailures,
      totalTools,
    })
  }

  export function top(assessment: Assessment, limit = 3) {
    return [...assessment.breakdown].sort((a, b) => b.points - a.points).slice(0, limit)
  }

  export function explain(assessment: Assessment, limit = 3) {
    return top(assessment, limit).map((item) => `${item.label}: ${item.detail} (+${item.points})`)
  }

  export function render(assessment: Assessment): string {
    const icon =
      assessment.level === "LOW"
        ? "."
        : assessment.level === "MEDIUM"
          ? "!"
          : assessment.level === "HIGH"
            ? "!!"
            : "!!!"
    return `Risk: ${assessment.level} (${assessment.score}/100) ${icon}\n  ${assessment.summary}`
  }
}
