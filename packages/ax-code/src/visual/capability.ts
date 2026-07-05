/**
 * Provider visual/tool capability metadata (ADR-047).
 *
 * Visual automation must route tasks based on capabilities, not
 * provider name alone. These types define the capability schema
 * that provider model metadata must advertise.
 */

export type ModelReasoningLevel = "none" | "basic" | "strong"
export type ModelSearchMode = "none" | "tool" | "server"

export type ModelVisualCapabilities = {
  toolCall: boolean
  visionInput: boolean
  jsonSchema: boolean
  reasoning: ModelReasoningLevel
  visualUiCritique: boolean
  browserActionPlanning: boolean
  search: ModelSearchMode
  maxImagePixels?: number
  maxImagesPerRequest?: number
}

/**
 * Check whether a model supports a required capability set.
 */
export function hasVisualCapabilities(
  caps: ModelVisualCapabilities,
  required: Partial<ModelVisualCapabilities>,
): boolean {
  if (required.toolCall && !caps.toolCall) return false
  if (required.visionInput && !caps.visionInput) return false
  if (required.jsonSchema && !caps.jsonSchema) return false
  if (required.visualUiCritique && !caps.visualUiCritique) return false
  if (required.browserActionPlanning && !caps.browserActionPlanning) return false
  if (required.reasoning) {
    const levels: Record<ModelReasoningLevel, number> = { none: 0, basic: 1, strong: 2 }
    if (levels[caps.reasoning] < levels[required.reasoning]) return false
  }
  return true
}

/**
 * Build a diagnostic message when a required capability is missing.
 */
export function missingCapabilityDiagnostic(
  caps: ModelVisualCapabilities,
  required: Partial<ModelVisualCapabilities>,
  modelName: string,
): string | undefined {
  const missing: string[] = []
  if (required.toolCall && !caps.toolCall) missing.push("tool_call")
  if (required.visionInput && !caps.visionInput) missing.push("vision_input")
  if (required.jsonSchema && !caps.jsonSchema) missing.push("json_schema")
  if (required.visualUiCritique && !caps.visualUiCritique) missing.push("visual_ui_critique")
  if (required.browserActionPlanning && !caps.browserActionPlanning) missing.push("browser_action_planning")
  if (required.reasoning) {
    const levels: Record<ModelReasoningLevel, number> = { none: 0, basic: 1, strong: 2 }
    if (levels[caps.reasoning] < levels[required.reasoning]) {
      missing.push(`reasoning:${required.reasoning} (has: ${caps.reasoning})`)
    }
  }
  if (missing.length === 0) return undefined
  return `Model "${modelName}" does not support: ${missing.join(", ")}. Configure a capable model for this visual task.`
}
