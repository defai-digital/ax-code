import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { TuiRendererName } from "./renderer-adapter/types"

const OPENTUI_RENDERER: TuiRendererName = "opentui"
const DEFAULT_NATIVE_PROMOTION_MANIFEST = new URL(
  "../../../../.tmp/tui-renderer-phase5/tui-renderer-phase5-manifest.json",
  import.meta.url,
)

type TuiRendererPromotionManifest = {
  renderer?: string
  opentuiFallbackRetained?: boolean
  decision?: {
    ready?: boolean
    action?: string
  }
}

export function resolveTuiRendererName(
  value = process.env["AX_CODE_TUI_RENDERER"],
  input: {
    nativeEnabled?: string
    manifestPath?: string
  } = {},
): TuiRendererName {
  const promoted = isNativeTuiRendererPromotedDefault(input.manifestPath)
  const requested = parseTuiRendererName(value, promoted ? "native" : OPENTUI_RENDERER)
  if (requested === "native" && !isNativeTuiRendererEnabled(input.nativeEnabled) && !promoted) return OPENTUI_RENDERER
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

export function resolveTuiRendererManifestPath(value = process.env["AX_CODE_TUI_RENDERER_MANIFEST"]) {
  if (value?.trim()) return path.resolve(value)
  return path.resolve(fileURLToPath(DEFAULT_NATIVE_PROMOTION_MANIFEST))
}

export function isNativeTuiRendererPromotedDefault(manifestPath = resolveTuiRendererManifestPath()) {
  if (!existsSync(manifestPath)) return false
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as TuiRendererPromotionManifest
    return (
      manifest.renderer === "native" &&
      manifest.opentuiFallbackRetained === true &&
      manifest.decision?.ready === true &&
      manifest.decision?.action === "promote-native-default"
    )
  } catch {
    return false
  }
}
