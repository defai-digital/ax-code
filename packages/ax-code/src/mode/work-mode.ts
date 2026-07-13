/**
 * Work mode: Agent (default) | Council | Arena — Qoder-style send routing.
 * Pure helpers shared by TUI (and mirrored on Desktop).
 */

export namespace WorkMode {
  export type Id = "agent" | "council" | "arena"

  export const ALL: readonly Id[] = ["agent", "council", "arena"] as const

  export const DEFAULT: Id = "agent"

  export function isWorkMode(value: unknown): value is Id {
    return value === "agent" || value === "council" || value === "arena"
  }

  export function parse(value: unknown, fallback: Id = DEFAULT): Id {
    return isWorkMode(value) ? value : fallback
  }

  export function cycle(current: Id): Id {
    const i = ALL.indexOf(current)
    return ALL[(i + 1) % ALL.length]!
  }

  export function label(mode: Id): string {
    switch (mode) {
      case "agent":
        return "Agent"
      case "council":
        return "Council"
      case "arena":
        return "Arena"
    }
  }

  export function shortLabel(mode: Id): string {
    switch (mode) {
      case "agent":
        return "agent"
      case "council":
        return "council"
      case "arena":
        return "arena"
    }
  }

  /**
   * Fixed chip colors (match Desktop WorkModeSelector):
   * Agent = green, Council = blue, Arena = purple.
   * Not theme.primary/etc. — those vary (e.g. default theme primary is peach).
   */
  export function chipColorHex(mode: Id): `#${string}` {
    switch (mode) {
      case "agent":
        return "#22c55e" // green-500
      case "council":
        return "#3b82f6" // blue-500
      case "arena":
        return "#a855f7" // purple-500
    }
  }

  export type Routed =
    | { kind: "prompt"; text: string }
    | { kind: "command"; command: "council" | "arena"; arguments: string }

  /**
   * Map free-text input through the selected work mode.
   * Explicit slash commands are left unchanged.
   */
  export function routeInput(mode: Id, text: string): Routed {
    const raw = text
    const trimmed = text.trim()
    if (!trimmed) return { kind: "prompt", text: raw }
    if (trimmed.startsWith("/")) return { kind: "prompt", text: raw }
    if (mode === "agent") return { kind: "prompt", text: raw }
    if (mode === "council") return { kind: "command", command: "council", arguments: raw }
    return { kind: "command", command: "arena", arguments: raw }
  }
}
