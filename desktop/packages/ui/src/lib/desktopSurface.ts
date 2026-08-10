/**
 * Top-level AX Code Desktop product surface (Codex-style Chat/Work toggle).
 *
 * - code: full coding workspace (sessions, git, files, diff, terminal, …)
 * - work: agentic general-purpose task mode (less IDE chrome, task-first)
 *
 * Distinct from per-directory `WorkMode` (Agent/Council/Arena routing).
 */

export const DESKTOP_SURFACES = ["code", "work"] as const

export type DesktopSurfaceId = (typeof DESKTOP_SURFACES)[number]

export const DEFAULT_DESKTOP_SURFACE: DesktopSurfaceId = "code"

export function isDesktopSurface(value: unknown): value is DesktopSurfaceId {
  return value === "code" || value === "work"
}

export function parseDesktopSurface(
  value: unknown,
  fallback: DesktopSurfaceId = DEFAULT_DESKTOP_SURFACE,
): DesktopSurfaceId {
  return isDesktopSurface(value) ? value : fallback
}
