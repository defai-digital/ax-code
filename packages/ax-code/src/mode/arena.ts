/**
 * Arena candidate ranking (ADR-049 D3).
 * Verify first, risk second, diversity third — never pure popularity.
 */

export namespace Arena {
  export type Verification = "pass" | "fail" | "unknown"

  export type Strategy = "verify_first" | "diversity" | "hybrid_score"

  export type ArenaCandidate = {
    id: string
    providerID: string
    modelID: string
    verification: Verification
    /** Lower is better (blast radius / risk). Missing sorts as neutral. */
    riskScore?: number
    /**
     * ADR-101: blinded rubric total (0–40) from the plan judge. When present
     * it replaces the self-assessed risk contribution as the plan signal.
     */
    judgeScore?: number
    /** Normalized fingerprint for near-duplicate detection. */
    patchFingerprint?: string
    /** Optional popularity signal — never used alone. */
    popularity?: number
  }

  export type RankedCandidate = ArenaCandidate & {
    rank: number
    score: number
    reasons: string[]
  }

  const VERIFY_RANK: Record<Verification, number> = {
    pass: 0,
    unknown: 1,
    fail: 2,
  }

  function baseScore(c: ArenaCandidate, strategy: Strategy): { score: number; reasons: string[] } {
    const reasons: string[] = [`verification:${c.verification}`, `strategy:${strategy}`]
    let score = 0

    if (c.verification === "pass") score += 100
    else if (c.verification === "unknown") score += 40

    if (typeof c.judgeScore === "number" && Number.isFinite(c.judgeScore)) {
      // ADR-101: the blinded rubric total is the primary plan signal;
      // self-assessed risk stays display-only when a judge score exists.
      const judge = Math.max(0, Math.min(40, c.judgeScore))
      score += judge
      reasons.push(`judge:${judge}`)
    } else if (typeof c.riskScore === "number" && Number.isFinite(c.riskScore)) {
      const risk = Math.max(0, Math.min(20, c.riskScore))
      const riskContribution = 20 - risk
      score += riskContribution
      reasons.push(`risk:${risk}`)
    } else {
      score += 10
      reasons.push("risk:neutral")
    }

    // Cap popularity so it cannot overturn verification (hybrid_score only)
    if (strategy === "hybrid_score" && typeof c.popularity === "number" && Number.isFinite(c.popularity)) {
      const pop = Math.max(0, Math.min(5, c.popularity))
      score += pop
      reasons.push(`popularity_capped:${pop}`)
    }

    return { score, reasons }
  }

  /**
   * Rank candidates. Higher score is better; returned array is best-first with rank 1..n.
   */
  export function rankArenaCandidates(
    candidates: readonly ArenaCandidate[],
    strategy: Strategy = "verify_first",
  ): RankedCandidate[] {
    if (candidates.length === 0) return []

    const scored = candidates.map((c) => {
      const { score, reasons } = baseScore(c, strategy)
      return { candidate: c, score, reasons }
    })

    // Primary order: verification tier, then base score
    scored.sort((a, b) => {
      const v = VERIFY_RANK[a.candidate.verification] - VERIFY_RANK[b.candidate.verification]
      if (v !== 0) return v
      return b.score - a.score
    })

    const selected: RankedCandidate[] = []
    const usedFingerprints = new Set<string>()

    // Process verification tiers in order; within each tier apply diversity preference.
    const tiers: Verification[] = ["pass", "unknown", "fail"]
    for (const tier of tiers) {
      const group = scored.filter((s) => s.candidate.verification === tier)
      const remaining = [...group]

      while (remaining.length) {
        let bestIdx = 0
        let bestAdjusted = -Infinity
        let bestReasons = remaining[0]!.reasons

        for (let i = 0; i < remaining.length; i++) {
          const row = remaining[i]!
          const fp = row.candidate.patchFingerprint?.trim()
          let adjusted = row.score
          const reasons = [...row.reasons]

          if (fp && usedFingerprints.has(fp)) {
            // Penalize duplicates so diversity is preserved among passers
            adjusted -= strategy === "verify_first" ? 3 : 8
            reasons.push("duplicate_fingerprint")
          } else if (fp && (strategy === "diversity" || strategy === "hybrid_score")) {
            adjusted += 4
            reasons.push("novel_fingerprint")
          }

          if (adjusted > bestAdjusted) {
            bestAdjusted = adjusted
            bestIdx = i
            bestReasons = reasons
          }
        }

        const chosen = remaining.splice(bestIdx, 1)[0]!
        const fp = chosen.candidate.patchFingerprint?.trim()
        if (fp) usedFingerprints.add(fp)
        selected.push({
          ...chosen.candidate,
          rank: selected.length + 1,
          score: bestAdjusted,
          reasons: bestReasons,
        })
      }
    }

    return selected
  }

  export type JudgeDimensionScores = {
    requirementCoverage: number
    feasibility: number
    verificationPlan: number
    riskEvidence: number
    total: number
  }

  export type JudgeScoreEntry = {
    candidate: string
    requirementCoverage: number
    feasibility: number
    verificationPlan: number
    riskEvidence: number
  }

  /**
   * ADR-101/102: map blinded judge labels back to member ids. Unknown or
   * duplicate labels are ignored; an empty map throws so the caller falls
   * back with a disclosure. Pure — exercised by the eval harness.
   */
  export function mapJudgeScores(
    output: { scores: readonly JudgeScoreEntry[] },
    memberIdByLabel: ReadonlyMap<string, string>,
  ): Map<string, JudgeDimensionScores> {
    const scores = new Map<string, JudgeDimensionScores>()
    for (const entry of output.scores) {
      const memberId = memberIdByLabel.get(entry.candidate.trim())
      if (!memberId || scores.has(memberId)) continue
      const requirementCoverage = Math.round(entry.requirementCoverage)
      const feasibility = Math.round(entry.feasibility)
      const verificationPlan = Math.round(entry.verificationPlan)
      const riskEvidence = Math.round(entry.riskEvidence)
      scores.set(memberId, {
        requirementCoverage,
        feasibility,
        verificationPlan,
        riskEvidence,
        total: requirementCoverage + feasibility + verificationPlan + riskEvidence,
      })
    }
    if (scores.size === 0) throw new Error("judge returned no usable candidate scores")
    return scores
  }

  export function renderRankingMarkdown(ranked: readonly RankedCandidate[]): string {
    const lines = ["# Arena ranking", ""]
    if (!ranked.length) {
      lines.push("_No candidates_")
      return lines.join("\n")
    }
    for (const c of ranked) {
      lines.push(
        `${c.rank}. **${c.providerID}/${c.modelID}** (\`${c.id}\`) — verify=${c.verification}, score=${c.score.toFixed(1)}`,
      )
      lines.push(`   reasons: ${c.reasons.join(", ")}`)
    }
    lines.push(
      "",
      "_Promotion is explicit. Prefer candidates that pass verification; do not merge by popularity alone._",
    )
    return lines.join("\n")
  }
}
