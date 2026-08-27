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
 *
 * Hardening (PRD harness-parity-phase1 R5):
 * - AX_CODE_AUTONOMOUS_GUARDIAN_MODEL selects a dedicated review model
 *   (e.g. a cheap/fast one); unset falls back to the default model.
 * - Transient review errors (provider overload, response stream
 *   disconnect/timeout, HTTP 5xx) are retried once before failing closed to
 *   "ask". Non-retryable errors (invalid request, auth, context window)
 *   fail closed immediately.
 * - Denial breaker: after DENIAL_STREAK_THRESHOLD consecutive denials within
 *   the last REVIEW_WINDOW_SIZE reviews, subsequent denials are downgraded
 *   to "ask" until a non-denial verdict resets the streak. Breaker state is
 *   per-Instance (ADR-060). The breaker only ever softens a guardian deny
 *   into an ask — it never downgrades an explicit user deny (those never
 *   reach the guardian) and never converts a deny into an allow.
 */

import { generateObject } from "ai"
import z from "zod"
import { Flag } from "@/flag/flag"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

// Note: Provider is imported dynamically inside resolveModel(), not here — a
// static import would create a module-init cycle (permission/index → guardian →
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

  // Initial attempt plus a single retry for transient errors (Codex
  // should_retry_guardian_review equivalent).
  const MAX_REVIEW_ATTEMPTS = 2

  const REVIEW_WINDOW_SIZE = 10
  const DENIAL_STREAK_THRESHOLD = 3

  // Retryable taxonomy, aligned with the transient/permanent split in
  // session/retry.ts: 5xx, overload, and transport-level failures (stream
  // disconnects, socket errors, provider-side timeouts) may succeed on an
  // immediate retry; 4xx request errors, auth failures, quota/billing
  // exhaustion, and context-window overflow are permanent.
  const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 413, 422])
  // Mirrors NON_RETRYABLE_PATTERNS in session/retry.ts — the AI SDK marks all
  // 429s retryable, but billing/quota exhaustion is permanent.
  const PERMANENT_MESSAGE_PATTERNS = [
    "quota",
    "billing",
    "payment required",
    "insufficient",
    "account suspended",
    "subscription",
    "context length",
    "context window",
    "maximum context",
    "invalid api key",
    "authentication",
    "unauthorized",
  ]
  const TRANSIENT_MESSAGE_PATTERNS = [
    "overloaded",
    "timeout",
    "timed out",
    "econnreset",
    "econnrefused",
    "enotfound",
    "etimedout",
    "eai_again",
    "socket hang up",
    "fetch failed",
    "network error",
    "connection reset",
    "stream disconnect",
    "terminated",
    "internal server error",
  ]

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

  interface BreakerState {
    /** Raw model verdicts (before breaker downgrade), most recent last. */
    recent: Array<Verdict["action"]>
  }

  // Per-instance breaker window (ADR-060) — NOT module scope, so separate
  // project instances never share a denial streak.
  const breaker = Instance.state((): BreakerState => ({ recent: [] }))

  function statusCodeOf(err: unknown): number | undefined {
    const code = (err as { statusCode?: unknown })?.statusCode
    return typeof code === "number" ? code : undefined
  }

  function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  export function isRetryableReviewError(err: unknown): boolean {
    const message = messageOf(err).toLowerCase()
    const status = statusCodeOf(err)
    if (status !== undefined && NON_RETRYABLE_STATUS.has(status)) return false
    if (PERMANENT_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern))) return false
    if (status !== undefined && (status === 429 || status >= 500)) return true
    // The AI SDK's APICallError carries its own retryability verdict for
    // transport-level failures (stream disconnects, socket errors).
    const retryable = (err as { isRetryable?: unknown })?.isRetryable
    if (retryable === true) return true
    if (retryable === false) return false
    return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern))
  }

  function trailingDenials(recent: ReadonlyArray<Verdict["action"]>): number {
    let count = 0
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i] !== "deny") break
      count++
    }
    return count
  }

  /**
   * Record a verdict in the per-instance sliding window and apply the denial
   * breaker: a deny arriving after DENIAL_STREAK_THRESHOLD consecutive denials
   * (within the window) is downgraded to ask so a stuck/over-strict reviewer
   * defers to the human instead of deadlocking the turn. The raw verdict is
   * what lands in the window, so a non-denial verdict resets the streak.
   */
  function record(verdict: Verdict): Verdict {
    try {
      const state = breaker()
      const streak = trailingDenials(state.recent)
      state.recent.push(verdict.action)
      if (state.recent.length > REVIEW_WINDOW_SIZE) state.recent.shift()
      if (verdict.action !== "deny" || streak < DENIAL_STREAK_THRESHOLD) return verdict
      log.warn("guardian denial breaker tripped; downgrading deny to ask", {
        consecutiveDenials: streak + 1,
        windowSize: REVIEW_WINDOW_SIZE,
        reason: verdict.reason,
      })
      return {
        action: "ask",
        reason: "guardian breaker: repeated consecutive denials; deferring to user",
      }
    } catch (err) {
      // Breaker state is per-Instance; a missing/disposed instance context
      // must not break the fail-closed posture.
      log.warn("guardian breaker state unavailable; failing closed to ask", {
        errorCode: err instanceof Error ? err.name : "Unknown",
      })
      return { action: "ask", reason: "guardian unavailable" }
    }
  }

  export function enabled(): boolean {
    return Flag.AX_CODE_AUTONOMOUS_GUARDIAN === true
  }

  type LanguageModel = Awaited<ReturnType<typeof import("@/provider/provider").Provider.getLanguage>>
  type ReviewModel = { language: LanguageModel; maxOutputTokens: number }

  /**
   * Resolve the review model: AX_CODE_AUTONOMOUS_GUARDIAN_MODEL when set, the
   * configured default model otherwise. Returns null when no default model is
   * configured, undefined on resolution failure (both fail closed to ask).
   */
  async function resolveModel(start: number): Promise<ReviewModel | null | undefined> {
    try {
      const { Provider } = await import("@/provider/provider")
      const override = Flag.AX_CODE_AUTONOMOUS_GUARDIAN_MODEL
      const modelRef = override ? Provider.parseModel(override) : await Provider.defaultModel()
      if (!modelRef) return null
      const resolved = await Provider.getModel(modelRef.providerID, modelRef.modelID)
      const { ProviderTransform } = await import("@/provider/transform")
      return {
        language: await Provider.getLanguage(resolved),
        maxOutputTokens: ProviderTransform.auxMaxOutputTokens(resolved),
      }
    } catch (err) {
      log.warn("guardian model resolution failed; failing closed to ask", {
        durationMs: Date.now() - start,
        errorCode: err instanceof Error ? err.name : "Unknown",
      })
      return undefined
    }
  }

  interface AttemptOutcome {
    verdict?: Verdict
    retryable: boolean
    reason: string
  }

  async function attemptReview(
    input: ReviewInput,
    model: ReviewModel,
    attempt: number,
    start: number,
  ): Promise<AttemptOutcome> {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), input.timeoutMs ?? 15_000)
    try {
      const lines = [
        `Permission: ${input.permission}`,
        input.tool ? `Tool: ${input.tool}` : null,
        `Patterns: ${input.patterns.join(" ")}`,
      ].filter((line): line is string => line !== null)
      const result = await generateObject({
        model: model.language,
        maxOutputTokens: model.maxOutputTokens,
        schema: GUARDIAN_OUTPUT,
        abortSignal: abort.signal,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: lines.join("\n") },
        ],
      })
      return { verdict: result.object, retryable: false, reason: "" }
    } catch (err) {
      // Our own abort deadline is not retried — the time budget is spent.
      const aborted = abort.signal.aborted
      const retryable = !aborted && isRetryableReviewError(err)
      log.warn(
        retryable && attempt < MAX_REVIEW_ATTEMPTS
          ? "guardian review failed with transient error; retrying once"
          : "guardian review failed; failing closed to ask",
        {
          permission: input.permission,
          durationMs: Date.now() - start,
          attempt,
          status: aborted ? "timeout" : "error",
          errorCode: err instanceof Error ? err.name : "Unknown",
          retryable,
        },
      )
      return { retryable, reason: aborted ? "guardian timeout" : "guardian unavailable" }
    } finally {
      clearTimeout(timer)
    }
  }

  export async function review(input: ReviewInput): Promise<Verdict> {
    const start = Date.now()
    const model = await resolveModel(start)
    if (model === null) return record({ action: "ask", reason: "no default model configured" })
    if (model === undefined) return record({ action: "ask", reason: "guardian unavailable" })

    const first = await attemptReview(input, model, 1, start)
    if (first.verdict) return record(first.verdict)
    if (!first.retryable) return record({ action: "ask", reason: first.reason })

    const second = await attemptReview(input, model, 2, start)
    return record(second.verdict ?? { action: "ask", reason: second.reason })
  }
}
