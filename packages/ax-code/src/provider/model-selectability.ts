// Providers allowed to surface models that don't advertise tool calling. For
// most providers a non-toolcall model is hidden from the picker because the
// agent needs tools, but these providers serve models a user may legitimately
// want anyway. ax-engine runs local MLX models (e.g. Gemma 4, GLM 4.7,
// Qwen3.6-35B-A3B) the user has deliberately downloaded; keep them selectable
// instead of silently dropping them from the local model list.
const TOOLCALL_OPTIONAL_PROVIDER_IDS = new Set([
  "claude-code",
  "gemini-cli",
  "codex-cli",
  "grok-build-cli",
  "qoder-cli",
  "antigravity-cli",
  "ax-engine",
])

export function providerModelSelectable(input: { providerID: string; toolcall?: boolean }) {
  if (input.toolcall !== false) return true
  return TOOLCALL_OPTIONAL_PROVIDER_IDS.has(input.providerID)
}

export function modelSelectableForProvider(
  providerID: string,
  model: { tool_call?: boolean; capabilities?: { toolcall?: boolean } } | undefined,
) {
  if (!model) return false
  return providerModelSelectable({
    providerID,
    toolcall: model.capabilities?.toolcall ?? model.tool_call,
  })
}
