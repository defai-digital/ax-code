import { Log } from "../util/log"
import { Snapshot } from "../snapshot"
import { Replay } from "../replay/replay"
import { EventQuery } from "../replay/query"
import type { ReplayEvent } from "../replay/event"
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
  }

  const SECURITY_PATTERNS = [
    /auth/i, /password/i, /secret/i, /token/i, /credential/i,
    /encrypt/i, /decrypt/i, /\.env/, /\.pem$/, /\.key$/,
    /permission/i, /oauth/i, /session/i, /cookie/i,
  ]

  function isSecurityRelated(files: string[]): boolean {
    return files.some((f) => SECURITY_PATTERNS.some((p) => p.test(f)))
  }

  function isCrossModule(files: string[]): boolean {
    const dirs = new Set(files.map((f) => f.split("/").slice(0, 2).join("/")))
    return dirs.size > 2
  }

  export function assess(signals: Signals): Assessment {
    let score = 0

    // File changes
    if (signals.filesChanged > 10) score += 30
    else if (signals.filesChanged > 5) score += 20
    else if (signals.filesChanged > 1) score += 10

    // Line changes
    if (signals.linesChanged > 500) score += 20
    else if (signals.linesChanged > 100) score += 10

    // Test coverage
    if (signals.testCoverage === 0 && signals.filesChanged > 0) score += 25
    else if (signals.testCoverage < 0.5) score += 15

    // API impact
    if (signals.apiEndpointsAffected > 0) score += 15

    // Cross-module
    if (signals.crossModule) score += 10

    // Security
    if (signals.securityRelated) score += 15

    // Validation
    if (signals.validationPassed === false) score += 20

    // Tool failures
    if (signals.toolFailures > 0) score += 10

    score = Math.min(score, 100)

    const level: Level =
      score >= 70 ? "CRITICAL" :
      score >= 50 ? "HIGH" :
      score >= 25 ? "MEDIUM" :
      "LOW"

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
    }
  }

  export function fromSession(sessionID: SessionID): Assessment {
    const events = EventQuery.bySession(sessionID)

    const files = new Set<string>()
    let additions = 0
    let deletions = 0
    let toolFailures = 0
    let totalTools = 0
    let validationPassed: boolean | undefined
    let apiEndpoints = 0

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
          const patch = (input.patch ?? "") as string
          const patchFiles = patch.match(/^[+-]{3}\s+[ab]\/(.+)$/gm)
          if (patchFiles) patchFiles.forEach((f) => files.add(f.replace(/^[+-]{3}\s+[ab]\//, "")))
        }
      }

      // Count additions/deletions from step.finish events
      if (e.type === "step.finish") {
        const tokens = e.tokens as Record<string, number> | undefined
        if (tokens) {
          additions += tokens.output ?? 0
        }
      }
    }

    const fileList = [...files]
    const linesChanged = additions + deletions

    return assess({
      filesChanged: fileList.length,
      linesChanged,
      testCoverage: validationPassed === undefined ? 0 : validationPassed ? 1 : 0,
      apiEndpointsAffected: apiEndpoints,
      crossModule: isCrossModule(fileList),
      securityRelated: isSecurityRelated(fileList),
      validationPassed,
      toolFailures,
      totalTools,
    })
  }

  export function render(assessment: Assessment): string {
    const icon = assessment.level === "LOW" ? "." :
                 assessment.level === "MEDIUM" ? "!" :
                 assessment.level === "HIGH" ? "!!" :
                 "!!!"
    return `Risk: ${assessment.level} (${assessment.score}/100) ${icon}\n  ${assessment.summary}`
  }
}
