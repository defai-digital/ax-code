/**
 * Grok server-side capabilities for ax-code.
 *
 * Active feature: xAI Live Search. Surfaced via the @ai-sdk/xai provider's
 * typed `searchParameters` option (chat completions endpoint). When enabled,
 * Grok decides per-turn whether to query real-world sources (web / X posts /
 * news / RSS feeds) before answering — handy for current-events questions
 * like weather, news, and X timelines.
 *
 * Not supported here: xAI's separate Agent Tools API (server_tools with
 * x_search / code_execution payloads). That targets a different endpoint
 * which ax-code does not call.
 *
 * Docs: https://docs.x.ai/docs/guides/live-search
 */

export type LiveSearchMode = "off" | "auto" | "on"

export type LiveSearchSource =
  | { type: "web"; country?: string; excludedWebsites?: string[]; allowedWebsites?: string[]; safeSearch?: boolean }
  | {
      type: "x"
      excludedXHandles?: string[]
      includedXHandles?: string[]
      postFavoriteCount?: number
      postViewCount?: number
      xHandles?: string[]
    }
  | { type: "news"; country?: string; excludedWebsites?: string[]; safeSearch?: boolean }
  | { type: "rss"; links: string[] }

export interface LiveSearchConfig {
  mode: LiveSearchMode
  returnCitations?: boolean
  fromDate?: string
  toDate?: string
  maxSearchResults?: number
  sources?: LiveSearchSource[]
}

// Defaults match Grok's strongest current-events behaviour: model decides
// when to search (auto), citations on so the user can verify, web+x+news
// sources covering both general queries and timely X chatter. Tweak via
// `provider.xai.models.<id>.options.searchParameters` in ax-code.json.
export const DEFAULT_LIVE_SEARCH: LiveSearchConfig = {
  mode: "auto",
  returnCitations: true,
  sources: [{ type: "web" }, { type: "x" }, { type: "news" }],
}

/**
 * Check if a model is eligible for xAI Live Search.
 * Multi-agent variants are excluded — they orchestrate sub-calls and ignore
 * top-level search parameters.
 */
export function supportsServerTools(modelId: string): boolean {
  const id = modelId.toLowerCase()
  if (id.includes("multi-agent")) return false
  return id.includes("grok-4") || id.includes("grok-code")
}

export const supportsLiveSearch = supportsServerTools

/**
 * Build the `searchParameters` provider option for a Grok model. Returns
 * undefined when the model is ineligible or when an explicit override sets
 * mode to "off" — in those cases the caller should omit the key entirely so
 * xAI's default (search disabled) applies.
 */
export function buildSearchParameters(
  modelId: string,
  override?: Partial<LiveSearchConfig>,
): LiveSearchConfig | undefined {
  if (!supportsLiveSearch(modelId)) return undefined
  if (override?.mode === "off") return undefined
  return { ...DEFAULT_LIVE_SEARCH, ...override }
}

/**
 * Check if a model supports reasoning/extended thinking.
 */
export function supportsReasoning(modelId: string): boolean {
  const id = modelId.toLowerCase()
  if (id.includes("non-reasoning")) return false
  if (id.includes("fast")) return false
  return id.includes("grok-4") || id.includes("grok-code")
}
