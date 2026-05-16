export const MODEL_VISION_MARKER = "👀"

export type VisionCapableModel = {
  name?: string
  capabilities?: { input?: { image?: boolean } }
}

export function supportsVision(model: { capabilities?: { input?: { image?: boolean } } } | undefined) {
  return model?.capabilities?.input?.image === true
}

export function modelVisionLabel(label: string, model: { capabilities?: { input?: { image?: boolean } } } | undefined) {
  return supportsVision(model) ? `${label} ${MODEL_VISION_MARKER}` : label
}

export function modelDisplayInfo(fallbackLabel: string, model: VisionCapableModel | undefined) {
  const searchText = model?.name ?? fallbackLabel
  const vision = supportsVision(model)
  return {
    label: vision ? `${searchText} ${MODEL_VISION_MARKER}` : searchText,
    searchText,
    vision,
  }
}
