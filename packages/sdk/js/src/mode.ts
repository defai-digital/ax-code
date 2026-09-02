/** Shared interaction modes for AX Code clients. */
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
    const index = ALL.indexOf(current)
    return ALL[(index + 1) % ALL.length]!
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

  export type Routed =
    | { kind: "prompt"; text: string }
    | { kind: "command"; command: "council" | "arena"; arguments: string }

  export function routeInput(mode: Id, text: string): Routed {
    const trimmed = text.trim()
    if (!trimmed) return { kind: "prompt", text }
    if (trimmed.startsWith("/")) return { kind: "prompt", text: trimmed }
    if (mode === "agent") return { kind: "prompt", text }
    if (mode === "council") return { kind: "command", command: "council", arguments: trimmed }
    return { kind: "command", command: "arena", arguments: trimmed }
  }
}
