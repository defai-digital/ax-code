/**
 * Semantic pre-approval guardian for autonomous mode (Codex auto_review
 * equivalent).
 *
 * Runs a cheap-model classification on RISK-class permissions that would
 * otherwise fall through to the ask path, so a clearly-safe action can be
 * auto-approved and a clearly-dangerous one (data exfiltration, credential
 * probing, destructive/irreversible changes) can be denied without waiting
 * for a human. "ask" — and any failure or timeout — falls back to the existing
 * ask path (fail-closed).
 *
 * Opt-in via AX_CODE_AUTONOMOUS_GUARDIAN=1. Off by default because each RISK
 * approval then adds a model round-trip. A "deny" never overrides an explicit
 * user allow rule: the guardian only evaluates actions that would otherwise
 * ask, not pre-approved ones (mirrors Codex auto_review, which reviews only
 * actions that already need approval).
 */

import { generateObject } from "ai"
import z from "zod"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"

// Note: Provider is imported dynamically inside review(), not here — a static
// import would create a module-init cycle (permission/index → guardian →
// provider → session/processor → agent → permission).

export namespace Guardian {
  const log = Log.create({ service: "permission.guardian" })

  const GUARDIAN_OUTPUT = z.object({
    action: z.enum(["allow", "deny", "ask"]),
    reason: z.string().min(1).max(200),
  })

  const SYSTEM = `You are a safety guardian for an autonomous coding agent.
Classify the requested action as allow, deny, or ask.
- deny: data exfiltration, credential probing, destructive or irreversible changes, or privilege escalation.
- allow: clearly safe, reversible, and within the stated task's scope.
- ask: anything uncertain, unusual, or outside the stated task.
Be conservative: when uncertain, choose ask.`

  export interface ReviewInput {
    permission: string
    patterns: string[]
    tool?: string
    timeoutMs?: number
  }

  export interface Verdict {
    action: "allow" | "deny" | "ask"
    reason: string
  }

  export function enabled(): boolean {
    return Flag.AX_CODE_AUTONOMOUS_GUARDIAN === true
  }

  export async function review(input: ReviewInput): Promise<Verdict> {
    const start = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    const abort = new AbortController()
    try {
      const { Provider } = await import("@/provider/provider")
      const override = Flag.AX_CODE_AUTONOMOUS_GUARDIAN_MODEL
      const modelRef = override ? Provider.parseModel(override) : await Provider.defaultModel()
      if (!modelRef) return { action: "ask", reason: "no default model configured" }
      const resolved = await Provider.getModel(modelRef.providerID, modelRef.modelID)
      const language = await Provider.getLanguage(resolved)
      timer = setTimeout(() => abort.abort(), input.timeoutMs ?? 15_000)
      const lines = [
        `Permission: ${input.permission}`,
        input.tool ? `Tool: ${input.tool}` : null,
        `Patterns: ${input.patterns.join(" ")}`,
      ].filter((line): line is string => line !== null)
      return await generateObject({
        model: language,
        schema: GUARDIAN_OUTPUT,
        abortSignal: abort.signal,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: lines.join("\n") },
        ],
      }).then((r) => r.object)
    } catch (err) {
      const aborted = abort.signal.aborted
      log.warn("guardian review failed; failing closed to ask", {
        permission: input.permission,
        durationMs: Date.now() - start,
        status: aborted ? "timeout" : "error",
        errorCode: err instanceof Error ? err.name : "Unknown",
      })
      return { action: "ask", reason: aborted ? "guardian timeout" : "guardian unavailable" }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
