// --tui-mode: first-class CLI switch for the TUI render backend. It maps onto
// the AX_CODE_NATIVE_RENDER / AX_CODE_NATIVE_RENDER_SCOPE env switches read by
// the vendored opentui-core overlay (applyNativeRenderOverlay), so it must run
// before the renderer library is first resolved and before the backend child
// is spawned (children inherit the resolved env).
//
//   (no flag) -> leave env untouched; the overlay's built-in default is the
//                battle-tested Zig library (post-v6.9.x rollback), while an
//                explicitly exported AX_CODE_NATIVE_RENDER still works.
//   zig       -> force the bundled Zig library (overrides any env opt-in)
//   native    -> full Rust render core (@ax-code/render napi addon)
//   yoga      -> Rust yoga/audio only; the render pipeline stays on Zig

export const TUI_MODE_CHOICES = ["zig", "native", "yoga"] as const

export type TuiRenderBackendMode = (typeof TUI_MODE_CHOICES)[number]

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
