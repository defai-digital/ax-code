import type { TuiRendererName } from "./renderer-adapter/types"

const OPENTUI_RENDERER: TuiRendererName = "opentui"

export function resolveTuiRendererName(value = process.env["AX_CODE_TUI_RENDERER"]): TuiRendererName {
  const requested = parseTuiRendererName(value, OPENTUI_RENDERER)
  if (requested === "native" && !isNativeTuiRendererEnabled()) return OPENTUI_RENDERER
  return requested
}

export function parseTuiRendererName(
  value: string | undefined,
  fallback: TuiRendererName = OPENTUI_RENDERER,
): TuiRendererName {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return fallback
  if (normalized === "opentui" || normalized === "native") return normalized
  throw new Error(`Invalid TUI renderer: ${value}. Expected opentui or native.`)
}

export function isNativeTuiRendererEnabled(value = process.env["AX_CODE_TUI_NATIVE_ENABLED"]) {
  const normalized = value?.trim().toLowerCase()
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on"
}
