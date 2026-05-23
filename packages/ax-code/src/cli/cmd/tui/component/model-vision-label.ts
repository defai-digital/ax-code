export const MODEL_VISION_MARKER = "👀"
export const MODEL_WEB_SEARCH_MARKER = "🌐"

export type DisplayCapableModel = {
  id?: string
  providerID?: string
  api?: { id?: string; npm?: string }
  name?: string
  capabilities?: { input?: { image?: boolean }; toolcall?: boolean }
}

export function supportsVision(model: { capabilities?: { input?: { image?: boolean } } } | undefined) {
  return model?.capabilities?.input?.image === true
}

export function supportsWebSearch(model: DisplayCapableModel | undefined) {
  if (!model) return false
  const providerID = model.providerID?.toLowerCase()
  const apiID = model.api?.id?.toLowerCase() ?? model.id?.toLowerCase() ?? ""
  const apiNpm = model.api?.npm

  if (providerID === "claude-code" || providerID === "codex-cli" || providerID === "gemini-cli") return true
  if (
    apiNpm === "@ai-sdk/xai" &&
    !apiID.includes("multi-agent") &&
    (apiID.includes("grok-4") || apiID.includes("grok-code"))
  )
    return true
  if (
    apiNpm === "@ai-sdk/openai-compatible" &&
    (providerID?.startsWith("alibaba-coding-plan") || providerID?.startsWith("alibaba-token-plan")) &&
    apiID.startsWith("qwen")
  )
    return true

  return false
}

export function modelVisionLabel(label: string, model: { capabilities?: { input?: { image?: boolean } } } | undefined) {
  return supportsVision(model) ? `${label} ${MODEL_VISION_MARKER}` : label
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
