/**
 * Phase-boundary diff critic for autonomous mode (PRD v4.2.0 P1-3).
 *
 * Runs after a phase's executor reports success and before the planner
 * advances. Reviews the resulting diff for logic, regression risk, and
 * security issues that typecheck/lint/test cannot see, and emits the
 * findings as `Finding[]` so they can ride existing `VerificationEnvelope`
 * artifact paths.
 *
 * Disabled by default. Opt-in via `quality.critic_enabled: true` in
 * `ax-code.json`. Intentionally cheap: one structured `generateObject`
 * call per phase, gated to architect-or-default model.
 */

import { generateObject } from "ai"
import z from "zod"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { Recorder } from "@/replay/recorder"
import type { SessionID } from "@/session/schema"
import { Log } from "@/util/log"
import { computeFindingId, type Finding, CategoryEnum, SeverityEnum } from "./finding"
import { configuredArchitectModel } from "@/planner/replan-llm"

export namespace Critic {
  const log = Log.create({ service: "quality.critic" })

  const RAW_FINDING = z.object({
    severity: SeverityEnum,
    category: CategoryEnum,
    file: z.string().min(1),
    line: z.number().int().min(1),
    summary: z.string().min(1).max(200),
    rationale: z.string().min(1),
    suggestedNextAction: z.string().min(1),
  })

  const CRITIC_OUTPUT = z.object({
    overallAssessment: z.string().min(1).max(500),
    findings: z.array(RAW_FINDING).max(20),
  })

  const SYSTEM = `You are a code-review critic for an autonomous AI coding session.
Review the provided diff for logic bugs, regressions, security flaws, behavior changes that
contradict the phase description, and missing verification. Be concrete: cite the file and
line number for every finding. Prefer fewer high-quality findings over many low-signal ones.
Severity: CRITICAL = will break prod, HIGH = will likely break, MEDIUM = risky, LOW = nit,
INFO = stylistic. Do not flag style-only issues unless they affect correctness.`

  export interface ReviewInput {
    phaseId: string
    phaseDescription: string
    diff: string
    /** Override the critic model. Defaults to the configured architect model, then to default. */
    model?: { providerID: string; modelID: string }
    /** Run id propagated into Finding.source for audit. Defaults to phaseId. */
    runId?: string
    timeoutMs?: number
    /** When provided, per-finding and architect-call telemetry is emitted to the Recorder. */
    sessionID?: SessionID
  }

  export interface ReviewResult {
    overallAssessment: string
    findings: Finding[]
  }

  export async function enabled(): Promise<boolean> {
    const cfg = await Config.get()
    return (cfg as { quality?: { critic_enabled?: boolean } }).quality?.critic_enabled === true
  }

  export async function review(input: ReviewInput): Promise<ReviewResult> {
    const start = Date.now()
    const explicit = input.model
      ? { providerID: input.model.providerID as never, modelID: input.model.modelID as never }
      : null
    const modelRef = explicit ?? (await configuredArchitectModel()) ?? (await Provider.defaultModel())
    const resolved = await Provider.getModel(modelRef.providerID, modelRef.modelID)
    const language = await Provider.getLanguage(resolved)

    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), input.timeoutMs ?? 60_000)
    const modelLabel = `${modelRef.providerID}/${modelRef.modelID}`
    let raw: z.infer<typeof CRITIC_OUTPUT>
    try {
      raw = await generateObject({
        model: language,
        schema: CRITIC_OUTPUT,
        abortSignal: abort.signal,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              `Phase id: ${input.phaseId}`,
              `Phase description: ${input.phaseDescription}`,
              "",
              "Diff under review:",
              "```diff",
              input.diff,
              "```",
            ].join("\n"),
          },
        ],
      }).then((r) => r.object)
    } catch (err) {
      const aborted = abort.signal.aborted
      log.warn("critic call failed", {
        phaseId: input.phaseId,
        durationMs: Date.now() - start,
        status: aborted ? "timeout" : "error",
        errorCode: err instanceof Error ? err.name : "Unknown",
      })
      if (input.sessionID) {
        Recorder.emit({
          type: "planner.architect_call",
          sessionID: input.sessionID,
          model: modelLabel,
          durationMs: Date.now() - start,
          status: aborted ? "timeout" : "error",
        })
      }
      return { overallAssessment: "critic unavailable", findings: [] }
    } finally {
      clearTimeout(timer)
    }

    const runId = input.runId ?? input.phaseId
    const findings: Finding[] = raw.findings.map((f) => {
      const anchor = { kind: "line" as const, line: f.line }
      const ruleId = `axcode:critic-${f.category.replace(/_/g, "-")}` as const
      const findingId = computeFindingId({
        workflow: "review",
        category: f.category,
        file: f.file,
        anchor,
        ruleId,
      })
      return {
        schemaVersion: 1 as const,
        findingId,
        workflow: "review" as const,
        category: f.category,
        severity: f.severity,
        summary: f.summary,
        file: f.file,
        anchor,
        rationale: f.rationale,
        evidence: [],
        suggestedNextAction: f.suggestedNextAction,
        ruleId,
        source: { tool: "ax-code-critic", version: "1", runId },
      }
    })

    log.info("critic completed", {
      phaseId: input.phaseId,
      durationMs: Date.now() - start,
      status: "completed",
      findingCount: findings.length,
      blockingCount: findings.filter((f) => f.severity === "HIGH" || f.severity === "CRITICAL").length,
    })

    if (input.sessionID) {
      Recorder.emit({
        type: "planner.architect_call",
        sessionID: input.sessionID,
        model: modelLabel,
        durationMs: Date.now() - start,
        status: "completed",
        phaseCount: 1,
      })
      for (const f of findings) {
        Recorder.emit({
          type: "quality.critic_finding",
          sessionID: input.sessionID,
          phaseId: input.phaseId,
          severity: f.severity,
          ruleId: f.ruleId,
          file: f.file,
          line: f.anchor.kind === "line" ? f.anchor.line : undefined,
          summary: f.summary,
        })
      }
    }

    return { overallAssessment: raw.overallAssessment, findings }
  }

  /**
   * Convenience reviewer for `Planner.execute({ phaseReviewer })`. Captures
   * `sessionID` so per-finding telemetry is emitted, then turns blocking
   * findings into a `block: true` signal so the planner runs the configured
   * fallback (usually `replan`).
   */
  export function asPhaseReviewer(opts: { sessionID?: SessionID; getDiff: (phaseId: string) => Promise<string> }) {
    return async (phase: { id: string; description: string }, _result: unknown, _plan: unknown) => {
      if (!(await enabled())) return { block: false }
      const diff = await opts.getDiff(phase.id)
      if (!diff) return { block: false }
      const result = await review({
        phaseId: phase.id,
        phaseDescription: phase.description,
        diff,
        sessionID: opts.sessionID,
      })
      if (!isBlocking(result.findings)) return { block: false }
      const summary = result.findings
        .filter((f) => f.severity === "HIGH" || f.severity === "CRITICAL")
        .map(
          (f) =>
            `${f.severity} ${f.ruleId ?? f.category} @ ${f.file}:${f.anchor.kind === "line" ? f.anchor.line : "?"} — ${f.summary}`,
        )
        .join("; ")
      return { block: true, error: `critic blocked phase: ${summary}` }
    }
  }

  /** True if any finding should block plan continuation. */
  export function isBlocking(findings: Finding[]): boolean {
    return findings.some((f) => f.severity === "CRITICAL" || f.severity === "HIGH")
  }
}
