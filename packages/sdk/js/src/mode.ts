/**
 * Shared interaction modes (`WorkMode`) for AX Code clients: the canonical
 * mode ids, validation, and helpers shared by CLI, TUI, and SDK consumers.
 *
 * @module
 */

/** Shared interaction modes for AX Code clients. */
export namespace WorkMode {
  /** Canonical work-mode identifier. */
  export type Id = "agent" | "council" | "arena"

  /** All work modes in cycling order. */
  export const ALL: readonly Id[] = ["agent", "council", "arena"] as const
  /** The default work mode. */
  export const DEFAULT: Id = "agent"

  /** Type guard: whether `value` is a known work mode id. */
  export function isWorkMode(value: unknown): value is Id {
    return value === "agent" || value === "council" || value === "arena"
  }

  /** Parse an unknown value into a work mode, falling back when invalid. */
  export function parse(value: unknown, fallback: Id = DEFAULT): Id {
    return isWorkMode(value) ? value : fallback
  }

  /** Return the next work mode after `current` in cycling order. */
  export function cycle(current: Id): Id {
    const index = ALL.indexOf(current)
    return ALL[(index + 1) % ALL.length]!
  }

  /** Human-readable display label for a work mode. */
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

  /** Compact lowercase label used in dense UI chrome. */
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

  /** Brand color for the mode chip in TUI surfaces. */
  export function chipColorHex(mode: Id): `#${string}` {
    switch (mode) {
      case "agent":
        return "#22c55e"
      case "council":
        return "#3b82f6"
      case "arena":
        return "#a855f7"
    }
  }

  /** How routed input is interpreted in a mode: a prompt, or a mode command. */
  export type Routed =
    | { kind: "prompt"; text: string }
    | { kind: "command"; command: "council" | "arena"; arguments: string }

  /** Route raw user input under a work mode into a prompt or mode command. */
  export function routeInput(mode: Id, text: string): Routed {
    const trimmed = text.trim()
    if (!trimmed) return { kind: "prompt", text }
    if (trimmed.startsWith("/")) return { kind: "prompt", text: trimmed }
    if (mode === "agent") return { kind: "prompt", text }
    if (mode === "council") return { kind: "command", command: "council", arguments: trimmed }
    return { kind: "command", command: "arena", arguments: trimmed }
  }
}
