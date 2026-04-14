import type { TuiRendererName } from "./renderer-adapter/types"

export function resolveTuiRendererName(value = process.env["AX_CODE_TUI_RENDERER"]): TuiRendererName {
  return parseTuiRendererName(value, "opentui")
}

export function parseTuiRendererName(
  value: string | undefined,
  fallback: TuiRendererName = "opentui",
): TuiRendererName {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return fallback
  if (normalized === "opentui" || normalized === "native") return normalized
  throw new Error(`Invalid TUI renderer: ${value}. Expected opentui or native.`)
}
