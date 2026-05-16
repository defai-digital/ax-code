import { runtimeMode, type RuntimeMode } from "@/installation/runtime-mode"

export function shouldUseTuiAnimations(input: { userEnabled?: boolean; runtime?: RuntimeMode } = {}) {
  if (input.userEnabled === false) return false
  return (input.runtime ?? runtimeMode()) !== "compiled"
}
