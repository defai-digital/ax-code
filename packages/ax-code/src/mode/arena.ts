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

    if (typeof c.riskScore === "number" && Number.isFinite(c.riskScore)) {
      const riskContribution = Math.max(0, 20 - Math.min(20, c.riskScore))
      score += riskContribution
      reasons.push(`risk:${c.riskScore}`)
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
