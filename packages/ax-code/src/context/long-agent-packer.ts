// Long-agent context packer (v0 — deterministic, no live LSP/provider required).
//
// Tiers (assembled in order, budget consumed left-to-right):
//   Tier 0 — current task + AGENTS.md + active instructions + tool constraints (always included)
//   Tier 1 — touched files, selected symbols, failing tests, current diff
//   Tier 2 — dependency/call graph summaries, related files, API contracts
//   Tier 3 — stable docs, historical failures, PRD/ADR references, benchmark notes
//
// Token budgeting is character-based (÷4 approximation). The packer skips
// individual entries that would exceed the configured budget and keeps trying
// later entries in the same tier.

export namespace LongAgentContextPacker {
  // ~4 chars per token, good-enough for planning/packing purposes.
  const CHARS_PER_TOKEN = 4

  export type Tier = 0 | 1 | 2 | 3

  export type Entry = {
    tier: Tier
    label: string
    content: string
  }

  export type PackInput = {
    tokenBudget: number
    task?: string
    agentsMd?: string
    instructions?: string[]
    toolConstraints?: string
    touchedFiles?: Array<{ path: string; summary: string }>
    symbols?: Array<{ name: string; signature: string }>
    failingTests?: string[]
    diff?: string
    dependencyGraphSummary?: string
    relatedFiles?: Array<{ path: string; snippet: string }>
    apiContracts?: string
    stableDocs?: string
    historicalFailures?: string[]
    prdAdrRefs?: string[]
    benchmarkNotes?: string
  }

  export type PackResult = {
    entries: Entry[]
    totalTokens: number
    droppedTiers: Tier[]
    debugSummary: string
  }

  function approxTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN)
  }

  function makeEntry(tier: Tier, label: string, content: string): Entry {
    return { tier, label, content }
  }

  export function pack(input: PackInput): PackResult {
    const budgetChars = input.tokenBudget * CHARS_PER_TOKEN
    let used = 0
    const entries: Entry[] = []
    const dropped = new Set<Tier>()

    function tryAdd(entry: Entry): boolean {
      if (used + entry.content.length > budgetChars) return false
      entries.push(entry)
      used += entry.content.length
      return true
    }

    function tryAddAll(tier: Tier, candidates: Entry[]): void {
      let skipped = false
      for (const e of candidates) {
        if (!tryAdd(e)) {
          skipped = true
        }
      }
      if (skipped) dropped.add(tier)
    }

    // Tier 0 — always included (if budget allows). Required for agent to function.
    const tier0: Entry[] = []
    if (input.task) tier0.push(makeEntry(0, "task", input.task))
    if (input.agentsMd) tier0.push(makeEntry(0, "agents-md", input.agentsMd))
    if (input.instructions?.length) {
      tier0.push(makeEntry(0, "instructions", input.instructions.join("\n")))
    }
    if (input.toolConstraints) tier0.push(makeEntry(0, "tool-constraints", input.toolConstraints))
    tryAddAll(0, tier0)

    // Tier 1 — task-context (skip if Tier 0 consumed most budget)
    const tier1: Entry[] = []
    if (input.touchedFiles?.length) {
      for (const f of input.touchedFiles) {
        tier1.push(makeEntry(1, `touched:${f.path}`, `# ${f.path}\n${f.summary}`))
      }
    }
    if (input.symbols?.length) {
      tier1.push(makeEntry(1, "symbols", input.symbols.map((s) => `${s.name}: ${s.signature}`).join("\n")))
    }
    if (input.failingTests?.length) {
      tier1.push(makeEntry(1, "failing-tests", input.failingTests.join("\n")))
    }
    if (input.diff) tier1.push(makeEntry(1, "diff", input.diff))
    tryAddAll(1, tier1)

    // Tier 2 — wider repo context
    const tier2: Entry[] = []
    if (input.dependencyGraphSummary) tier2.push(makeEntry(2, "dep-graph", input.dependencyGraphSummary))
    if (input.relatedFiles?.length) {
      for (const f of input.relatedFiles) {
        tier2.push(makeEntry(2, `related:${f.path}`, `# ${f.path}\n${f.snippet}`))
      }
    }
    if (input.apiContracts) tier2.push(makeEntry(2, "api-contracts", input.apiContracts))
    tryAddAll(2, tier2)

    // Tier 3 — stable reference docs (lowest priority)
    const tier3: Entry[] = []
    if (input.stableDocs) tier3.push(makeEntry(3, "stable-docs", input.stableDocs))
    if (input.historicalFailures?.length) {
      tier3.push(makeEntry(3, "historical-failures", input.historicalFailures.join("\n")))
    }
    if (input.prdAdrRefs?.length) {
      tier3.push(makeEntry(3, "prd-adr-refs", input.prdAdrRefs.join("\n")))
    }
    if (input.benchmarkNotes) tier3.push(makeEntry(3, "benchmark-notes", input.benchmarkNotes))
    tryAddAll(3, tier3)

    const totalTokens = approxTokens(entries.map((e) => e.content).join(""))
    const droppedTiers = [...dropped].sort() as Tier[]

    const tierCounts = [0, 1, 2, 3].map((t) => entries.filter((e) => e.tier === t).length)
    const debugSummary = [
      `budget=${input.tokenBudget}tok used≈${totalTokens}tok`,
      `tiers: 0=${tierCounts[0]} 1=${tierCounts[1]} 2=${tierCounts[2]} 3=${tierCounts[3]}`,
      droppedTiers.length ? `dropped: ${droppedTiers.join(",")}` : "all tiers fit",
    ].join(" | ")

    return { entries, totalTokens, droppedTiers, debugSummary }
  }

  // Render entries as a concatenated context string for system prompt insertion.
  export function render(result: PackResult): string {
    return result.entries.map((e) => e.content).join("\n\n")
  }
}
