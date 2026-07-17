// TUI engine selection.
//
// `zig` is the supported production UI: Node + Solid + OpenTUI with the
// bundled Zig renderer. `native` is a separate Rust process built on Ratatui;
// it is not an OpenTUI renderer overlay. Keeping the switch at this layer lets
// the launcher choose the Rust client before importing the Solid application.

export const TUI_MODE_CHOICES = ["zig", "native"] as const

export type TuiEngine = (typeof TUI_MODE_CHOICES)[number]

export const TUI_SUPPORTED_ENGINE = "zig" as const satisfies TuiEngine
export const TUI_ENGINE_ENV = "AX_CODE_TUI_ENGINE"

export function normalizeTuiEngine(value: string | undefined): TuiEngine | undefined {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "zig" || normalized === "opentui") return "zig"
  if (normalized === "native" || normalized === "ratatui" || normalized === "rust") return "native"
  return undefined
}

export function resolveEffectiveTuiEngine(env: Record<string, string | undefined> = process.env): TuiEngine {
  return normalizeTuiEngine(env[TUI_ENGINE_ENV]) ?? TUI_SUPPORTED_ENGINE
}

export function isExperimentalTuiEngine(engine: TuiEngine): boolean {
  return engine !== TUI_SUPPORTED_ENGINE
}

/**
 * Resolve an explicit CLI choice over the environment and retire the old
 * OpenTUI Rust/N-API overlay in every case. The legacy variables remain
 * present with disabled values so shell environment hydration cannot re-add a
 * stale `AX_CODE_NATIVE_RENDER=1` or yoga scope after this decision.
 */
export function applyTuiEngineMode(
  mode: string | undefined,
  env: Record<string, string | undefined> = process.env,
): TuiEngine {
  const explicit = normalizeTuiEngine(mode)
  const engine = explicit ?? resolveEffectiveTuiEngine(env)
  if (explicit) env[TUI_ENGINE_ENV] = explicit

  // ADR-046's Rust renderer/yoga overlay has been superseded by the standalone
  // Ratatui engine. Zig/OpenTUI must always use its bundled Zig library.
  env.AX_CODE_NATIVE_RENDER = "0"
  env.AX_CODE_NATIVE_RENDER_SCOPE = ""

  return engine
}
