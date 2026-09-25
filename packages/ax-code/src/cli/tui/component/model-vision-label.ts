export const MODEL_VISION_MARKER = "👀"
export const MODEL_WEB_SEARCH_MARKER = "🌐"
const CLI_WEB_SEARCH_PROVIDER_IDS = new Set([
  "claude-code",
  "codex-cli",
  "grok-build-cli",
  "muse-cli",
])

export type DisplayCapableModel = {
  id?: string
  providerID?: string
  api?: { id?: string; npm?: string }
  name?: string
  capabilities?: { input?: { image?: boolean }; toolcall?: boolean; websearch?: boolean }
}

export function supportsVision(model: { capabilities?: { input?: { image?: boolean } } } | undefined) {
  return model?.capabilities?.input?.image === true
}

export function supportsWebSearch(model: DisplayCapableModel | undefined) {
  if (!model) return false
  const providerID = model.providerID?.toLowerCase()
  const apiID = model.api?.id?.toLowerCase() ?? model.id?.toLowerCase() ?? ""
  const apiNpm = model.api?.npm

  // An explicit `true` claims server-side web search even where the hardcoded
  // allowlist below would not: the AX Trust gateway knows which SKUs it can
  // search with. `false` is not a veto — the bundled snapshot sets it on every
  // model, including the CLI models the allowlist exists to mark.
  if (model.capabilities?.websearch === true) return true
  if (providerID && CLI_WEB_SEARCH_PROVIDER_IDS.has(providerID)) return true
  if (
    apiNpm === "@ai-sdk/openai-compatible" &&
    (providerID?.startsWith("alibaba-coding-plan") || providerID?.startsWith("alibaba-token-plan")) &&
    apiID.startsWith("qwen")
  )
    return true

  return false
}

export function modelDisplayInfo(fallbackLabel: string, model: DisplayCapableModel | undefined) {
  const rawName = model?.name ?? fallbackLabel
  const vision = supportsVision(model)
  const webSearch = supportsWebSearch(model)
  const markers = [vision ? MODEL_VISION_MARKER : undefined, webSearch ? MODEL_WEB_SEARCH_MARKER : undefined]
    .filter((marker): marker is string => Boolean(marker))
    .join(" ")
  // Strip marker emojis that are already present in the model name from
  // models-snapshot.json (e.g., "Qwen3.7 Max 🌐", "Grok 4.3 🌐") to
  // avoid duplicating them when we append computed markers.
  const searchText = rawName.replaceAll(MODEL_WEB_SEARCH_MARKER, "").replaceAll(MODEL_VISION_MARKER, "").trimEnd()
  return {
    label: markers ? `${searchText} ${markers}` : searchText,
    searchText,
    vision,
    webSearch,
  }
}
