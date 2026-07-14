import { modelSelectableForProvider } from "@/provider/model-selectability"

type DialogModelOptionInfo = {
  id?: string
  tool_call?: boolean
  capabilities?: {
    toolcall?: boolean
    output?: { text?: boolean }
  }
  options?: { minMemoryBytes?: unknown }
}

export function dialogModelOptionDisabled(
  providerID: string,
  modelID: string,
  model: DialogModelOptionInfo | undefined,
) {
  if (!modelSelectableForProvider(providerID, model)) return true
  return providerID === "opencode" && modelID.includes("-nano")
}
