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

/** Fixed chip colors matching TUI WorkMode.chipColorHex — Agent green, Council blue, Arena purple. */
export function workModeChipColorHex(mode: WorkModeId): `#${string}` {
  switch (mode) {
    case "agent":
      return "#22c55e"
    case "council":
      return "#3b82f6"
    case "arena":
      return "#a855f7"
  }
}

export type WorkModeRouted =
  | { kind: "prompt"; text: string }
  | { kind: "command"; command: "council" | "arena"; arguments: string }

/** Map free-text through work mode. Explicit slash commands are unchanged. */
export function routeWorkModeInput(mode: WorkModeId, text: string): WorkModeRouted {
  const raw = text
  const trimmed = text.trim()
  if (!trimmed) return { kind: "prompt", text: raw }
  // Strip leading whitespace so "  /help" still counts as an explicit slash command.
  if (trimmed.startsWith("/")) return { kind: "prompt", text: trimmed }
  if (mode === "agent") return { kind: "prompt", text: raw }
  // Trimmed body keeps council/arena $ARGUMENTS clean.
  if (mode === "council") return { kind: "command", command: "council", arguments: trimmed }
  return { kind: "command", command: "arena", arguments: trimmed }
}

/**
 * Resolve send content through work mode + slash detection.
 * Shared by routeMessage so leading whitespace cannot bypass slash/work-mode routing.
 */
export function resolveWorkModeSend(
  mode: WorkModeId,
  content: string,
): {
  content: string
  forcedCommand: { name: "council" | "arena"; arguments: string } | null
} {
  const routed = routeWorkModeInput(mode, content)
  if (routed.kind === "command") {
    return {
      content: `/${routed.command} ${routed.arguments}`.trimEnd(),
      forcedCommand: { name: routed.command, arguments: routed.arguments },
    }
  }
  // Explicit slash (possibly after leading whitespace) — use normalized text.
  if (routed.text.trimStart().startsWith("/")) {
    return { content: routed.text, forcedCommand: null }
  }
  return { content: routed.text, forcedCommand: null }
}
