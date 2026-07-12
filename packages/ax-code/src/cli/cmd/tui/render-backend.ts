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
//   (no flag) -> leave env untouched; overlay default = Zig. Explicit
//                AX_CODE_NATIVE_RENDER still works for lab use.
//   zig       -> force the bundled Zig library (overrides any env opt-in)
//   native    -> full Rust render core (@ax-code/render napi addon) [experimental]
//   yoga      -> Rust yoga/audio only; render pipeline stays on Zig [experimental]

export const TUI_MODE_CHOICES = ["zig", "native", "yoga"] as const

/** Supported production backend. All other choices are experimental. */
export const TUI_SUPPORTED_RENDER_BACKEND = "zig" as const satisfies TuiRenderBackendMode

export type TuiRenderBackendMode = (typeof TUI_MODE_CHOICES)[number]

export function isExperimentalTuiRenderBackend(mode: TuiRenderBackendMode): boolean {
  return mode !== TUI_SUPPORTED_RENDER_BACKEND
}

export function applyTuiRenderBackendMode(
  mode: string | undefined,
  env: Record<string, string | undefined> = process.env,
): void {
  switch (mode) {
    case "zig":
      env["AX_CODE_NATIVE_RENDER"] = "0"
      delete env["AX_CODE_NATIVE_RENDER_SCOPE"]
      return
    case "native":
      env["AX_CODE_NATIVE_RENDER"] = "1"
      delete env["AX_CODE_NATIVE_RENDER_SCOPE"]
      return
    case "yoga":
      env["AX_CODE_NATIVE_RENDER"] = "1"
      env["AX_CODE_NATIVE_RENDER_SCOPE"] = "yoga"
      return
    default:
      // No flag: keep whatever the environment says; the overlay itself
      // defaults to Zig when nothing is set.
      return
  }
}
