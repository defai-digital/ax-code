/**
 * Ensemble budget gates (ADR-049 D7). Pure — fail-closed when caps exceeded.
 */

export namespace Budget {
  export type EnsembleBudget = {
    maxMembers: number
    maxContestants: number
    timeoutMs: number
    maxEstimatedUsd?: number
    /** Soft estimate of cost per member call (USD). */
    estimatedUsdPerMember?: number
  }

  export type CheckInput = {
    kind: "council" | "arena"
    requestedMembers: number
    callsPerMember?: number
    budget: EnsembleBudget
  }

  export type CheckResult =
    | { ok: true; allowedMembers: number; estimatedUsd?: number; reasons: string[] }
    | { ok: false; reason: string; message: string }

  const HARD_MAX = 6

  export function resolveCaps(budget: EnsembleBudget, kind: "council" | "arena"): number {
    const configured = kind === "council" ? budget.maxMembers : budget.maxContestants
    return Math.max(1, Math.min(HARD_MAX, configured))
  }

  /**
   * Fail closed if the request cannot run under budget.
   * Truncation to cap is allowed and reported; over-cap after truncation is not needed.
   */
  export function check(input: CheckInput): CheckResult {
    const reasons: string[] = []
    const cap = resolveCaps(input.budget, input.kind)
    if (input.requestedMembers < 1) {
      return {
        ok: false,
        reason: "no_members",
        message: "Ensemble requires at least one member candidate.",
      }
    }

    let allowed = Math.min(input.requestedMembers, cap)
    if (input.requestedMembers > cap) {
      reasons.push(`capped:${input.requestedMembers}->${cap}`)
    }

    if (allowed < 2 && input.kind === "arena") {
      return {
        ok: false,
        reason: "insufficient_after_cap",
        message: `Arena needs at least 2 contestants after budget cap (cap=${cap}).`,
      }
    }

    const per = input.budget.estimatedUsdPerMember
    const maxUsd = input.budget.maxEstimatedUsd
    if (typeof per === "number" && per >= 0 && typeof maxUsd === "number" && maxUsd >= 0) {
      const callsPerMember =
        typeof input.callsPerMember === "number" && Number.isFinite(input.callsPerMember)
          ? Math.max(1, Math.floor(input.callsPerMember))
          : 1

      const estimatedPerMember = per * callsPerMember
      if (callsPerMember > 1) reasons.push(`calls_per_member:${callsPerMember}`)
      // How many members fit under USD budget?
      if (estimatedPerMember > 0) {
        const tolerance = Number.EPSILON * Math.max(1, Math.abs(maxUsd), Math.abs(estimatedPerMember)) * 4
        const maxByUsd = Math.floor((maxUsd + tolerance) / estimatedPerMember)
        if (maxByUsd < 2 && input.kind === "arena") {
          return {
            ok: false,
            reason: "usd_budget",
            message: `Estimated cost exceeds modes.budget.maxEstimatedUsd ($${maxUsd}). Need ≥2 contestants.`,
          }
        }
        if (maxByUsd < 1) {
          return {
            ok: false,
            reason: "usd_budget",
            message: `Estimated cost exceeds modes.budget.maxEstimatedUsd ($${maxUsd}).`,
          }
        }
        if (allowed > maxByUsd) {
          reasons.push(`usd_cap:${allowed}->${maxByUsd}`)
          allowed = maxByUsd
        }
      }
      const estimatedUsd = allowed * estimatedPerMember
      reasons.push(`estimated_usd:${estimatedUsd.toFixed(4)}`)
      return { ok: true, allowedMembers: allowed, estimatedUsd, reasons }
    }

    return { ok: true, allowedMembers: allowed, reasons }
  }
}
