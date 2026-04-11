import { existsSync, readFileSync } from "fs"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"
import { EventQuery } from "../replay/query"
import { Snapshot } from "../snapshot"
import { SessionSemanticCore } from "../session/semantic-core"
import type { SessionID } from "../session/schema"

const log = Log.create({ service: "risk" })

export namespace Risk {
  export type Level = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  export type ValidationState = "not_run" | "passed" | "failed" | "partial"
  export type DiffState = "recorded" | "derived" | "missing"
  export type SemanticRisk = SessionSemanticCore.Risk
  export type Readiness = "ready" | "needs_validation" | "needs_review" | "blocked"

  export type Signals = {
    filesChanged: number
    linesChanged: number
    testCoverage: number
    apiEndpointsAffected: number
    crossModule: boolean
    securityRelated: boolean
    validationPassed: boolean | undefined
    validationState?: ValidationState
    validationCount?: number
    validationFailures?: number
    validationCommands?: string[]
    toolFailures: number
    totalTools: number
    diffState?: DiffState
    semanticRisk?: SemanticRisk | null
    primaryChange?: SessionSemanticCore.Kind | null
  }

  export type NormalizedSignals = Omit<Signals, "validationState" | "validationCount" | "validationFailures" | "validationCommands" | "diffState"> & {
    validationState: ValidationState
    validationCount: number
    validationFailures: number
    validationCommands: string[]
    diffState: DiffState
    semanticRisk: SemanticRisk | null
    primaryChange: SessionSemanticCore.Kind | null
  }

  export type Assessment = {
    level: Level
    score: number
    confidence: number
    readiness: Readiness
    signals: NormalizedSignals
    summary: string
    breakdown: Factor[]
    evidence: string[]
    unknowns: string[]
    mitigations: string[]
  }

  export type Factor = {
    kind: "files" | "lines" | "tests" | "api" | "module" | "security" | "validation" | "tools" | "semantic"
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
    return dirs.size > 1
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

  function validationState(input: Signals): ValidationState {
    if (input.validationState) return input.validationState
    if (input.validationPassed === true) return "passed"
    if (input.validationPassed === false) return "failed"
    return input.testCoverage > 0 ? "partial" : "not_run"
  }

  function normalize(input: Signals): NormalizedSignals {
    const state = validationState(input)
    const count = input.validationCount ?? (state === "not_run" ? 0 : 1)
    const failures = input.validationFailures ?? (state === "failed" ? Math.max(1, count) : 0)
    const diffState = input.diffState ?? (input.filesChanged > 0 || input.linesChanged > 0 ? "derived" : "missing")
    return {
      ...input,
      testCoverage: state === "passed" ? 1 : state === "partial" ? Math.max(input.testCoverage, 0.5) : 0,
      validationState: state,
      validationCount: count,
      validationFailures: failures,
      validationCommands: [...new Set(input.validationCommands ?? [])],
      diffState,
      semanticRisk: input.semanticRisk ?? null,
      primaryChange: input.primaryChange ?? null,
    }
  }

  function confidence(signals: NormalizedSignals) {
    const base =
      0.35 +
      (signals.diffState === "recorded" ? 0.25 : signals.diffState === "derived" ? 0.12 : 0) +
      (signals.validationState === "passed" || signals.validationState === "failed"
        ? 0.22
        : signals.validationState === "partial"
          ? 0.1
          : signals.filesChanged === 0
            ? 0.1
            : -0.05) +
      (signals.primaryChange && signals.diffState !== "missing" ? 0.08 : 0) -
      Math.min(0.15, signals.toolFailures * 0.05)
    return Math.max(0.1, Math.min(0.99, Number(base.toFixed(2))))
  }

  function readiness(signals: NormalizedSignals, confidence: number): Readiness {
    if (signals.validationState === "failed") return "blocked"
    if (signals.filesChanged > 0 && signals.validationState === "not_run") return "needs_validation"
    if (confidence < 0.45) return "needs_review"
    return "ready"
  }

  function text(input: Readiness) {
    return input.replaceAll("_", " ")
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
    const next = normalize(signals)
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
      next.filesChanged > 10 ? 25 : next.filesChanged > 5 ? 15 : next.filesChanged > 1 ? 8 : 0,
      `${next.filesChanged} files changed`,
    )

    push(
      "lines",
      "Code churn",
      next.linesChanged > 500 ? 20 : next.linesChanged > 100 ? 12 : next.linesChanged > 30 ? 5 : 0,
      `${next.linesChanged} lines changed`,
    )

    push(
      "tests",
      "Validation scope",
      next.validationState === "partial" ? 6 : 0,
      next.validationCommands.length > 0 ? `${next.validationCommands.length} validation commands recorded` : "partial validation coverage",
    )

    push(
      "api",
      "API surface",
      next.apiEndpointsAffected > 0 ? 12 : 0,
      `${next.apiEndpointsAffected} route files affected`,
    )

    push("module", "Cross-module scope", next.crossModule ? 8 : 0, "changes span multiple top-level areas")

    push("security", "Security-sensitive area", next.securityRelated ? 15 : 0, "security-related files touched")

    push(
      "semantic",
      "Semantic change",
      next.semanticRisk === "high" ? 10 : next.semanticRisk === "medium" ? 4 : 0,
      next.primaryChange ? `${SessionSemanticCore.format(next.primaryChange)} classified as ${next.semanticRisk} risk` : "semantic change unavailable",
    )

    push(
      "validation",
      "Validation result",
      next.validationState === "failed" ? 20 : 0,
      "validation output reported failure",
    )

    push(
      "tools",
      "Tool stability",
      next.toolFailures > 0 ? Math.min(15, 6 + next.toolFailures * 2) : 0,
      `${next.toolFailures}/${next.totalTools} tool calls failed`,
    )

    score = Math.min(score, 100)

    const level: Level = score >= 70 ? "CRITICAL" : score >= 45 ? "HIGH" : score >= 20 ? "MEDIUM" : "LOW"
    const conf = confidence(next)
    const ready = readiness(next, conf)

    const parts: string[] = []
    if (next.filesChanged > 0) parts.push(`${next.filesChanged} files changed`)
    if (next.primaryChange) parts.push(SessionSemanticCore.format(next.primaryChange))
    if (next.securityRelated) parts.push("security-related files")
    if (next.crossModule) parts.push("cross-module change")
    if (next.apiEndpointsAffected > 0) parts.push(`${next.apiEndpointsAffected} API endpoints`)
    if (next.validationState === "failed") parts.push("validation failed")
    if (next.toolFailures > 0) parts.push(`${next.toolFailures} tool failures`)

    const evidence = [
      next.diffState === "recorded"
        ? `diff snapshot recorded for ${next.filesChanged} file${next.filesChanged === 1 ? "" : "s"}`
        : next.diffState === "derived"
          ? "change scope derived from tool events"
          : "",
      next.validationCount > 0
        ? next.validationCommands.length > 0
          ? `validation recorded: ${next.validationCommands.slice(0, 2).join(" · ")}`
          : `${next.validationCount} validation run${next.validationCount === 1 ? "" : "s"} recorded`
        : "",
      next.primaryChange ? `semantic change classified as ${SessionSemanticCore.format(next.primaryChange)}` : "",
      next.toolFailures > 0 ? `${next.toolFailures} tool failure${next.toolFailures === 1 ? "" : "s"} recorded` : "",
    ].filter(Boolean)

    const unknowns = [
      next.diffState === "missing" && next.filesChanged > 0 ? "no diff snapshot recorded for changed files" : "",
      next.diffState === "derived" ? "line churn is estimated from tool events, not a persisted diff" : "",
      next.filesChanged > 0 && next.validationState === "not_run" ? "no validation command recorded for code changes" : "",
      next.validationState === "partial" ? "validation covered only part of the change" : "",
    ].filter(Boolean)

    const mitigations = [
      next.filesChanged > 0 && next.validationState === "not_run" ? "run validation before accepting this session" : "",
      next.validationState === "partial" ? "expand validation to the touched files or routes" : "",
      next.diffState !== "recorded" && next.filesChanged > 0 ? "persist a session diff snapshot before trusting churn estimates" : "",
      next.apiEndpointsAffected > 0 ? "exercise the touched routes with endpoint or contract checks" : "",
      next.securityRelated ? "review auth, session, or credential paths with an owner" : "",
    ].filter(Boolean)

    return {
      level,
      score,
      confidence: conf,
      readiness: ready,
      signals: next,
      summary: parts.length > 0 ? parts.join(", ") : next.filesChanged > 0 ? "code change recorded" : "minimal change",
      breakdown,
      evidence,
      unknowns,
      mitigations,
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
    const validation = new Map<string, string>()
    const runs = [] as Array<{ command: string; failed: boolean }>
    for (const event of events) {
      const e = event as Record<string, unknown>

      if (e.type === "tool.result") {
        totalTools++
        if (e.status === "error") toolFailures++

        const tool = e.tool as string
        const call = validation.get((e.callID as string) ?? "")
        if (tool === "bash" && call) {
          const output = (e.output as string) ?? ""
          runs.push({
            command: call,
            failed: validationFailed({
              command: call,
              status: e.status as "completed" | "error",
              output,
            }),
          })
          validation.delete((e.callID as string) ?? "")
        }
      }

      if (e.type === "tool.call") {
        const tool = e.tool as string
        const input = (e.input as Record<string, unknown>) ?? {}

        if (tool === "bash") {
          const cmd = String(input.command ?? input.cmd ?? "")
          if (isValidation(cmd)) validation.set((e.callID as string) ?? "", cmd)
        }

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
    const semantic = diff ? SessionSemanticCore.summarize(diff) ?? null : null
    const failed = runs.filter((item) => item.failed).length
    const passed = runs.length > 0 && failed === 0
    const partial = runs.length > 0 && failed > 0 && failed < runs.length
    const validationState = passed ? "passed" : failed > 0 ? (partial ? "partial" : "failed") : "not_run"

    return assess({
      filesChanged: fileList.length,
      linesChanged,
      testCoverage: validationState === "passed" ? 1 : validationState === "partial" ? 0.5 : 0,
      apiEndpointsAffected: api(fileList),
      crossModule: isCrossModule(fileList),
      securityRelated: isSecurityRelated(fileList),
      validationPassed: validationState === "passed" ? true : validationState === "failed" ? false : undefined,
      validationState,
      validationCount: runs.length,
      validationFailures: failed,
      validationCommands: runs.map((item) => item.command),
      toolFailures,
      totalTools,
      diffState: diff ? "recorded" : fileList.length > 0 || linesChanged > 0 ? "derived" : "missing",
      semanticRisk: semantic?.risk ?? null,
      primaryChange: semantic?.primary ?? null,
    })
  }

  function isValidation(input: string) {
    return [
      /\b(?:bun|pnpm|npm|yarn)\s+(?:run\s+)?test\b/i,
      /\b(?:bun|pnpm|npm|yarn)\s+(?:run\s+)?(?:typecheck|lint|build|check)\b/i,
      /\b(?:vitest|jest|mocha|ava|pytest|rspec|phpunit)\b/i,
      /\b(?:go test|cargo (?:test|check)|deno test|swift test|dotnet test)\b/i,
      /\btsc\b.*(?:--noEmit|-noEmit)\b/i,
      /\beslint\b/i,
    ].some((pat) => pat.test(input))
  }

  function testCommand(input: string) {
    return [/\b(?:bun|pnpm|npm|yarn)\s+(?:run\s+)?test\b/i, /\b(?:vitest|jest|mocha|ava|pytest|rspec|phpunit)\b/i].some((pat) =>
      pat.test(input),
    )
  }

  function validationFailed(input: { command: string; status: "completed" | "error"; output: string }) {
    if (input.status === "error") return true
    if (!testCommand(input.command)) return false
    const text = input.output.toLowerCase()
    if (/\b0\s+fail(?:ed|ures?)?\b/.test(text) || /\b0\s+errors?\b/.test(text)) return false
    return (
      /\b[1-9]\d*\s+fail(?:ed|ures?)?\b/.test(text) ||
      /\btest suites:\s*[1-9]\d*\s+failed\b/i.test(input.output) ||
      /\bFAIL\b/.test(input.output)
    )
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
    return `Risk: ${assessment.level} (${assessment.score}/100) ${icon}\n  ${assessment.summary}\n  readiness ${text(assessment.readiness)} · confidence ${assessment.confidence.toFixed(2)}`
  }
}
