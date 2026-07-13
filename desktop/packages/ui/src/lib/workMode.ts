/**
 * Work mode: Agent (default) | Council | Arena — Qoder-style send routing.
 * Keep in sync with packages/ax-code/src/mode/work-mode.ts
 */

export type WorkModeId = "agent" | "council" | "arena"

export const WORK_MODES: readonly WorkModeId[] = ["agent", "council", "arena"] as const

export const DEFAULT_WORK_MODE: WorkModeId = "agent"

export function isWorkMode(value: unknown): value is WorkModeId {
  return value === "agent" || value === "council" || value === "arena"
}

export function parseWorkMode(value: unknown, fallback: WorkModeId = DEFAULT_WORK_MODE): WorkModeId {
  return isWorkMode(value) ? value : fallback
}

export function cycleWorkMode(current: WorkModeId): WorkModeId {
  const i = WORK_MODES.indexOf(current)
  return WORK_MODES[(i + 1) % WORK_MODES.length]!
}

export type WorkModeRouted =
  | { kind: "prompt"; text: string }
  | { kind: "command"; command: "council" | "arena"; arguments: string }

/** Map free-text through work mode. Explicit slash commands are unchanged. */
export function routeWorkModeInput(mode: WorkModeId, text: string): WorkModeRouted {
  const raw = text
  const trimmed = text.trim()
  if (!trimmed) return { kind: "prompt", text: raw }
  if (trimmed.startsWith("/")) return { kind: "prompt", text: raw }
  if (mode === "agent") return { kind: "prompt", text: raw }
  if (mode === "council") return { kind: "command", command: "council", arguments: raw }
  return { kind: "command", command: "arena", arguments: raw }
}
