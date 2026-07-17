import os from "os"

// Providers allowed to surface models that don't advertise tool calling. For
// most providers a non-toolcall model is hidden from the picker because the
// agent needs tools, but these CLI providers serve models a user may
// legitimately want anyway.
const TOOLCALL_OPTIONAL_PROVIDER_IDS = new Set([
  "claude-code",
  "gemini-cli",
  "codex-cli",
  "grok-build-cli",
  "qoder-cli",
  "antigravity-cli",
  "kimi-cli",
])

type SelectableModel = {
  tool_call?: boolean
  capabilities?: {
    toolcall?: boolean
    output?: { text?: boolean }
  }
  options?: { minMemoryBytes?: unknown }
}

export function modelMemoryBlockReason(
  providerID: string,
  model: { options?: { minMemoryBytes?: unknown } } | undefined,
  memoryBytes: number = os.totalmem(),
) {
  if (providerID !== "ax-engine") return undefined
  const minMemoryBytes = model?.options?.minMemoryBytes
  if (typeof minMemoryBytes !== "number" || minMemoryBytes <= 0) return undefined
  if (memoryBytes >= minMemoryBytes) return undefined
  return `requires ${Math.ceil(minMemoryBytes / 1024 ** 3)}GB unified memory`
}

export function providerModelSelectable(input: { providerID: string; toolcall?: boolean }) {
  if (input.toolcall !== false) return true
  return TOOLCALL_OPTIONAL_PROVIDER_IDS.has(input.providerID)
}

export function modelSelectableForProvider(providerID: string, model: SelectableModel | undefined) {
  if (!model) return false
  if (modelMemoryBlockReason(providerID, model)) return false
  // AX Code's agent loop requires a textual assistant response. Models that
  // explicitly advertise image-only (or other non-text) output cannot produce
  // a usable coding turn, even when they accept tool schemas.
  if (model.capabilities?.output?.text === false) return false
  return providerModelSelectable({
    providerID,
    toolcall: model.capabilities?.toolcall ?? model.tool_call,
  })
}
