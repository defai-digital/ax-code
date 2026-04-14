import type { TuiRendererName } from "./renderer-adapter/types"

export function resolveTuiRendererName(value = process.env["AX_CODE_TUI_RENDERER"]): TuiRendererName {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "native") return "native"
  return "opentui"
}
