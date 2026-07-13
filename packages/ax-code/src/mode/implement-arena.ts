/**
 * Worktree implement-arena result scoring (ADR-049 Phase 3).
 * Pure helpers — converts implement outcomes into Arena candidates.
 */

import { Arena } from "./arena"
import { WorktreePolicy } from "./worktree-policy"

export namespace ImplementArena {
  export type ContestantResult = {
    id: string
    providerID: string
    modelID: string
    worktreeDirectory?: string
    worktreeBranch?: string
    sessionID?: string
    /** Did the agent session complete without hard error? */
    completed: boolean
    /** Verification command outcomes */
    verification: Arena.Verification
    verifyDetail?: string
    riskScore?: number
    /** Normalized patch fingerprint (diff hash or empty) */
    patchFingerprint?: string
    summary?: string
    error?: string
  }

  export type RankedImplement = Arena.RankedCandidate & {
    worktreeDirectory?: string
    worktreeBranch?: string
    sessionID?: string
    summary?: string
    verifyDetail?: string
    error?: string
  }

  export function toArenaCandidate(result: ContestantResult): Arena.ArenaCandidate {
    return {
      id: result.id,
      providerID: result.providerID,
      modelID: result.modelID,
      verification: result.verification,
      riskScore: result.riskScore,
      patchFingerprint: result.patchFingerprint,
      popularity: 0,
    }
  }

  export function rank(
    results: readonly ContestantResult[],
    strategy: Arena.Strategy = "verify_first",
  ): RankedImplement[] {
    const candidates = results.map(toArenaCandidate)
    const ranked = Arena.rankArenaCandidates(candidates, strategy)
    const byId = new Map(results.map((r) => [r.id, r]))
    return ranked.map((r) => {
      const src = byId.get(r.id)
      return {
        ...r,
        worktreeDirectory: src?.worktreeDirectory,
        worktreeBranch: src?.worktreeBranch,
        sessionID: src?.sessionID,
        summary: src?.summary,
        verifyDetail: src?.verifyDetail,
        error: src?.error,
      }
    })
  }

  export function renderMarkdown(input: {
    task: string
    ranked: readonly RankedImplement[]
    strategy: Arena.Strategy
  }): string {
    const lines = [
      "# Implement arena ranking",
      "",
      `**Task:** ${input.task}`,
      `**Strategy:** ${input.strategy}`,
      "",
    ]
    if (!input.ranked.length) {
      lines.push("_No contestants_")
      return lines.join("\n")
    }
    for (const c of input.ranked) {
      lines.push(
        `${c.rank}. **${c.providerID}/${c.modelID}** (\`${c.id}\`) — verify=${c.verification}, score=${c.score.toFixed(1)}`,
      )
      if (c.worktreeDirectory) lines.push(`   worktree: \`${c.worktreeDirectory}\``)
      if (c.worktreeBranch) lines.push(`   branch: \`${c.worktreeBranch}\``)
      if (c.sessionID) lines.push(`   session: \`${c.sessionID}\``)
      if (c.summary) lines.push(`   summary: ${c.summary.slice(0, 300)}`)
      if (c.verifyDetail) lines.push(`   verify: ${c.verifyDetail}`)
      if (c.error) lines.push(`   error: ${c.error}`)
      lines.push(`   reasons: ${c.reasons.join(", ")}`)
    }
    lines.push(
      "",
      "_Winner is not auto-merged. Inspect the worktree, run extra checks, then cherry-pick or merge the branch._",
      "_Multi-writer isolation uses worktrees (WorktreePolicy). Main workspace is untouched by contestants._",
    )
    return lines.join("\n")
  }

  /** Policy check: implement arena always needs worktree isolation for N writers. */
  export function isolationForContestants(count: number): WorktreePolicy.IsolationMode {
    return count > 1 ? "worktree" : "shared"
  }
}
