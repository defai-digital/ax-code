// Provider-neutral prompt-cache policy.
// Classifies content blocks as stable (cache-eligible) or dynamic (skip-cache)
// and renders provider-specific cache_control annotations.
//
// Design notes:
// - "Stable" = content that does not change per-request: system instructions,
//   tool schemas, AGENTS.md, warmed repo-memory entries, stable context packs.
// - "Dynamic" = content that changes per turn: current user request, recent
//   tool results, failed command output, transient retry prompts.
// - The DashScope/OpenRouter Alibaba explicit-cache path requires per-block
//   cache_control with a 5-minute TTL. Until a route probe confirms support,
//   the policy defaults to off for unverified provider routes.

export namespace PromptCachePolicy {
  export type BlockKind = "stable" | "dynamic"

  export type CacheBlock = {
    kind: BlockKind
    content: string
    label?: string
  }

  export type PolicyMode = "off" | "alibaba-explicit"

  export type RenderResult = {
    mode: PolicyMode
    blocks: Array<{ content: string; cacheControl?: { type: "ephemeral" } }>
    debugLines: string[]
  }

  // Route-verified providers where Alibaba explicit-cache is known to work.
  // Off by default for unverified routes; extend after live probe confirms support.
  const ALIBABA_EXPLICIT_CACHE_PROVIDERS = new Set<string>([
    "alibaba-coding-plan",
    "alibaba-coding-plan-cn",
    "alibaba-token-plan",
    "alibaba-token-plan-cn",
  ])

  export function policyMode(providerID: string): PolicyMode {
    if (ALIBABA_EXPLICIT_CACHE_PROVIDERS.has(providerID)) return "alibaba-explicit"
    return "off"
  }

  // Block classifiers — callers assign labels; the policy decides stability.
  const STABLE_LABELS = new Set([
    "system",
    "tools",
    "agents-md",
    "repo-memory",
    "context-pack",
    "adr",
    "prd",
    "stable-rules",
  ])

  const DYNAMIC_LABELS = new Set([
    "user-request",
    "tool-result",
    "failed-command",
    "retry-prompt",
    "continuation",
    "transient",
  ])

  export function classifyBlock(label: string | undefined): BlockKind {
    if (!label) return "dynamic"
    const l = label.toLowerCase()
    if (STABLE_LABELS.has(l)) return "stable"
    if (DYNAMIC_LABELS.has(l)) return "dynamic"
    // Unknown labels default to dynamic (safe: no cache cost if missed).
    return "dynamic"
  }

  // Render blocks according to policy. For alibaba-explicit mode, stable blocks
  // receive cache_control; dynamic blocks do not. For "off" mode, no annotation.
  export function render(blocks: CacheBlock[], providerID: string): RenderResult {
    const mode = policyMode(providerID)
    const debugLines: string[] = []
    const rendered: RenderResult["blocks"] = []

    for (const block of blocks) {
      const kind = block.kind
      if (mode === "alibaba-explicit" && kind === "stable") {
        rendered.push({ content: block.content, cacheControl: { type: "ephemeral" } })
        debugLines.push(`[cache=stable] ${block.label ?? "(unlabeled)"} (${block.content.length}ch)`)
      } else {
        rendered.push({ content: block.content })
        debugLines.push(
          `[cache=${kind === "stable" ? "stable/off" : "skip"}] ${block.label ?? "(unlabeled)"} (${block.content.length}ch)`,
        )
      }
    }

    return { mode, blocks: rendered, debugLines }
  }

  // Build a CacheBlock list from labelled content strings.
  export function buildBlocks(entries: Array<{ label: string; content: string }>): CacheBlock[] {
    return entries.map((e) => ({
      kind: classifyBlock(e.label),
      content: e.content,
      label: e.label,
    }))
  }

  // Dry-run: render and return debug summary without annotating for wire use.
  export function debugRender(blocks: CacheBlock[], providerID: string): string {
    const { mode, debugLines } = render(blocks, providerID)
    return [`mode=${mode}`, ...debugLines].join("\n")
  }
}
