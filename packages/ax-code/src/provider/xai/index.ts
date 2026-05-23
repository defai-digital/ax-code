/**
 * XAI/Grok provider extensions for ax-code.
 *
 * Adds xAI Live Search defaults via the @ai-sdk/xai `searchParameters`
 * providerOption. Wired into ProviderTransform.options() so Grok models get
 * "auto" Live Search out of the box for current-events queries.
 */

export {
  type LiveSearchConfig,
  type LiveSearchMode,
  type LiveSearchSource,
  DEFAULT_LIVE_SEARCH,
  buildSearchParameters,
  supportsLiveSearch,
  supportsServerTools,
  supportsReasoning,
} from "./server-tools"
