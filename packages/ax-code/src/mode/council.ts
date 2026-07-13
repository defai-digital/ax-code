/**
 * Multi-LLM council aggregation (ADR-049 D4).
 * Pure — groups structured issues into consensus / majority / minority / singleton.
 */

export namespace Council {
  export type Severity = "high" | "medium" | "low"

  export type CouncilIssue = {
    memberId: string
    severity: Severity
    category: string
    location?: string
    summary: string
    suggestedFix?: string
  }

  export type CouncilMemberResult = {
    memberId: string
    providerID: string
    modelID: string
    overall?: string
    issues: CouncilIssue[]
    error?: string
  }

  export type AgreementTier = "consensus" | "majority" | "minority" | "singleton"

  export type AggregatedIssue = {
    key: string
    tier: AgreementTier
    severity: Severity
    category: string
    location?: string
    summary: string
    suggestedFix?: string
    memberIds: string[]
    supportCount: number
    totalMembers: number
  }

  export type CouncilReport = {
    totalMembers: number
    successfulMembers: number
    failedMembers: number
    incomplete: boolean
    consensus: AggregatedIssue[]
    majority: AggregatedIssue[]
    minority: AggregatedIssue[]
    singleton: AggregatedIssue[]
    memberErrors: Array<{ memberId: string; error: string }>
  }

  const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

  /** Collapse whitespace and case for deterministic grouping. */
  export function normalizeSummary(summary: string): string {
    return summary
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  export function issueKey(issue: Pick<CouncilIssue, "location" | "category" | "summary">): string {
    const loc = (issue.location ?? "").trim().toLowerCase()
    const cat = issue.category.trim().toLowerCase()
    const sum = normalizeSummary(issue.summary)
    return `${loc}|${cat}|${sum}`
  }

  function worstSeverity(a: Severity, b: Severity): Severity {
    return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b
  }

  function classifyTier(support: number, total: number): AgreementTier {
    if (total <= 0) return "singleton"
    if (support >= total) return "consensus"
    const majorityThreshold = Math.floor(total / 2) + 1
    if (support >= majorityThreshold && support >= 2) return "majority"
    if (support >= 2) return "minority"
    return "singleton"
  }

  export function aggregateCouncil(members: readonly CouncilMemberResult[]): CouncilReport {
    const successful = members.filter((m) => !m.error)
    const failed = members.filter((m) => m.error)
    const total = successful.length
    const incomplete = total < 2

    type Bucket = {
      key: string
      severity: Severity
      category: string
      location?: string
      summary: string
      suggestedFix?: string
      memberIds: Set<string>
    }

    const buckets = new Map<string, Bucket>()

    for (const member of successful) {
      for (const issue of member.issues) {
        const key = issueKey(issue)
        const existing = buckets.get(key)
        if (!existing) {
          buckets.set(key, {
            key,
            severity: issue.severity,
            category: issue.category,
            location: issue.location,
            summary: issue.summary,
            suggestedFix: issue.suggestedFix,
            memberIds: new Set([member.memberId]),
          })
        } else {
          existing.memberIds.add(member.memberId)
          existing.severity = worstSeverity(existing.severity, issue.severity)
          if (!existing.suggestedFix && issue.suggestedFix) existing.suggestedFix = issue.suggestedFix
          // Prefer longer summary for readability when equal
          if (issue.summary.length > existing.summary.length) existing.summary = issue.summary
        }
      }
    }

    const consensus: AggregatedIssue[] = []
    const majority: AggregatedIssue[] = []
    const minority: AggregatedIssue[] = []
    const singleton: AggregatedIssue[] = []

    for (const bucket of buckets.values()) {
      const supportCount = bucket.memberIds.size
      const tier = incomplete ? "singleton" : classifyTier(supportCount, total)
      const item: AggregatedIssue = {
        key: bucket.key,
        tier,
        severity: bucket.severity,
        category: bucket.category,
        location: bucket.location,
        summary: bucket.summary,
        suggestedFix: bucket.suggestedFix,
        memberIds: [...bucket.memberIds].sort(),
        supportCount,
        totalMembers: total,
      }
      if (tier === "consensus") consensus.push(item)
      else if (tier === "majority") majority.push(item)
      else if (tier === "minority") minority.push(item)
      else singleton.push(item)
    }

    const bySeverityThenSupport = (a: AggregatedIssue, b: AggregatedIssue) => {
      const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
      if (sev !== 0) return sev
      return b.supportCount - a.supportCount
    }

    consensus.sort(bySeverityThenSupport)
    majority.sort(bySeverityThenSupport)
    minority.sort(bySeverityThenSupport)
    singleton.sort(bySeverityThenSupport)

    return {
      totalMembers: members.length,
      successfulMembers: total,
      failedMembers: failed.length,
      incomplete,
      consensus,
      majority,
      minority,
      singleton,
      memberErrors: failed.map((m) => ({ memberId: m.memberId, error: m.error ?? "unknown" })),
    }
  }

  export function renderReportMarkdown(report: CouncilReport, question?: string): string {
    const lines: string[] = []
    lines.push("# Council report")
    if (question) lines.push("", `**Question:** ${question}`)
    lines.push(
      "",
      `Members: ${report.successfulMembers}/${report.totalMembers} successful` +
        (report.incomplete ? " — **incomplete** (need ≥2 successes for consensus tiers)" : ""),
    )

    if (report.memberErrors.length) {
      lines.push("", "## Member errors")
      for (const err of report.memberErrors) {
        lines.push(`- \`${err.memberId}\`: ${err.error}`)
      }
    }

    const section = (title: string, items: AggregatedIssue[]) => {
      lines.push("", `## ${title} (${items.length})`)
      if (!items.length) {
        lines.push("_None_")
        return
      }
      for (const item of items) {
        const loc = item.location ? ` @ \`${item.location}\`` : ""
        lines.push(
          `- **[${item.severity}]** ${item.category}${loc}: ${item.summary} ` +
            `(${item.supportCount}/${item.totalMembers}: ${item.memberIds.join(", ")})`,
        )
        if (item.suggestedFix) lines.push(`  - Suggested: ${item.suggestedFix}`)
      }
    }

    section("Consensus", report.consensus)
    section("Majority", report.majority)
    section("Minority observations", report.minority)
    section("Singleton observations", report.singleton)

    lines.push(
      "",
      "_Advisory only. Multi-model agreement is evidence, not proof — verify with tests before applying changes._",
    )
    return lines.join("\n")
  }

  /**
   * Prefer diverse provider families when selecting council members.
   * Heuristic: first path segment / known vendor prefix of provider id.
   */
  export function providerFamily(providerID: string): string {
    const id = providerID.toLowerCase()
    if (id.includes("anthropic") || id.includes("claude")) return "anthropic"
    if (id.includes("openai") || id.includes("codex") || id === "github-copilot") return "openai"
    if (id.includes("google") || id.includes("gemini") || id.includes("antigravity")) return "google"
    if (id.includes("xai") || id.includes("grok")) return "xai"
    if (id.includes("alibaba") || id.includes("qwen")) return "alibaba"
    if (id.includes("zai") || id.includes("zhipu") || id.includes("glm")) return "zhipu"
    if (id.includes("ax-engine") || id.includes("ollama") || id.includes("local")) return "local"
    if (id.includes("groq")) return "groq"
    if (id.includes("openrouter")) return "openrouter"
    return id.split(/[-_]/)[0] || id
  }

  export function dedupeMembers<T extends { providerID: string; modelID?: unknown }>(candidates: readonly T[]): T[] {
    const seen = new Set<string>()
    return candidates.filter((candidate) => {
      const key = `${candidate.providerID}\u0000${String(candidate.modelID ?? "")}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  export function selectDiverseMembers<T extends { providerID: string; modelID?: unknown }>(
    candidates: readonly T[],
    maxMembers: number,
  ): T[] {
    const cap = Math.max(1, Math.min(maxMembers, 6))
    const unique = dedupeMembers(candidates)
    const selected: T[] = []
    const seenFamilies = new Set<string>()

    // First pass: one per family
    for (const c of unique) {
      if (selected.length >= cap) break
      const fam = providerFamily(c.providerID)
      if (seenFamilies.has(fam)) continue
      seenFamilies.add(fam)
      selected.push(c)
    }
    // Second pass: fill remaining
    for (const c of unique) {
      if (selected.length >= cap) break
      if (selected.includes(c)) continue
      selected.push(c)
    }
    return selected
  }
}
