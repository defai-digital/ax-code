// Experimental TUI render-backend override for maintainers / dogfood.
//
// Supported production path is always Zig (OpenTUI bundled native library).
// The Rust core (native / yoga scopes) remains in-tree as an experimental
// successor candidate (ADR-046 overlay, ADR-047 blessed matrix) and must not
// be presented as a user-facing product choice until graduation criteria are
// met — see `.internal/tui-stability/ADR-047-tui-stability-hardening.md`.
//
// `--tui-mode` is a *hidden* CLI escape hatch that maps onto
// AX_CODE_NATIVE_RENDER / AX_CODE_NATIVE_RENDER_SCOPE before the renderer
// library is first resolved and before the backend child is spawned
// (children inherit the resolved env). Prefer the env vars for scripts/CI.
//
// Callers MUST await ensureShellEnv() before applyTuiRenderBackendMode so
// shell-profile values cannot re-inject SCOPE/flag after the CLI override
// (shell env only fills missing keys — see runtime/shell-env.ts).
//
//   (no flag) -> leave env untouched; overlay default = Zig. Explicit
//                AX_CODE_NATIVE_RENDER still works for lab use.
//   zig       -> force the bundled Zig library (overrides any env opt-in)
//   native    -> full Rust render core (@ax-code/render napi addon) [experimental]
//   yoga      -> Rust yoga/audio only; render pipeline stays on Zig [experimental]

export const TUI_MODE_CHOICES = ["zig", "native", "yoga"] as const

export type TuiRenderBackendMode = (typeof TUI_MODE_CHOICES)[number]

/** Supported production backend. All other choices are experimental. */
export const TUI_SUPPORTED_RENDER_BACKEND = "zig" as const satisfies TuiRenderBackendMode

export function isExperimentalTuiRenderBackend(mode: TuiRenderBackendMode): boolean {
  return mode !== TUI_SUPPORTED_RENDER_BACKEND
}

/** Match opentui-core applyNativeRenderOverlay truthiness (1/true/on). */
export function isNativeRenderEnvEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const flag = (env["AX_CODE_NATIVE_RENDER"] || "").toLowerCase()
  return flag === "1" || flag === "true" || flag === "on"
}

/**
 * Effective backend after env + CLI mapping, matching the overlay's rules:
 * native render only when AX_CODE_NATIVE_RENDER is explicitly on; SCOPE=yoga
 * narrows to yoga/audio while the rest of the pipeline stays Zig.
 */
export function resolveEffectiveTuiRenderBackend(
  env: Record<string, string | undefined> = process.env,
): TuiRenderBackendMode {
  if (!isNativeRenderEnvEnabled(env)) return "zig"
  const scope = (env["AX_CODE_NATIVE_RENDER_SCOPE"] || "").toLowerCase()
  return scope === "yoga" ? "yoga" : "native"
}

export function applyTuiRenderBackendMode(
  mode: string | undefined,
  env: Record<string, string | undefined> = process.env,
): TuiRenderBackendMode {
  const normalized = mode?.trim().toLowerCase()
  switch (normalized) {
    case "zig":
      env["AX_CODE_NATIVE_RENDER"] = "0"
      // Keep the key present (empty) so a late shell-env fill cannot re-inject
      // a profile SCOPE after the CLI override. Overlay treats non-"yoga" as full.
      env["AX_CODE_NATIVE_RENDER_SCOPE"] = ""
      break
    case "native":
      env["AX_CODE_NATIVE_RENDER"] = "1"
      env["AX_CODE_NATIVE_RENDER_SCOPE"] = ""
      break
    case "yoga":
      env["AX_CODE_NATIVE_RENDER"] = "1"
      env["AX_CODE_NATIVE_RENDER_SCOPE"] = "yoga"
      break
    default:
      // No flag: keep whatever the environment says; the overlay itself
      // defaults to Zig when nothing is set.
      break
  }
  return resolveEffectiveTuiRenderBackend(env)
}
