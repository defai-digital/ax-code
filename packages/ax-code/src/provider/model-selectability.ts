const TOOLCALL_OPTIONAL_PROVIDER_IDS = new Set([
  "claude-code",
  "gemini-cli",
  "codex-cli",
  "grok-build-cli",
  "qoder-cli",
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
