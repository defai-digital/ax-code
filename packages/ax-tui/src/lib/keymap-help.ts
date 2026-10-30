import stripAnsi from "strip-ansi"
import type { ActiveKeymapBinding } from "./keymap.js"

/** Display-only metadata; no handlers or renderable targets are retained. */
export type KeymapHelpBinding = Pick<ActiveKeymapBinding, "id" | "keys" | "description">

export interface KeymapHelpEntry {
  id: string
  shortcut: string
  description: string
}

const keyLabels = new Map([
  ["enter", "Enter"], ["return", "Enter"], ["esc", "Esc"], ["escape", "Esc"],
  ["space", "Space"], [" ", "Space"], ["plus", "Plus"], ["tab", "Tab"],
  ["backspace", "Backspace"], ["delete", "Delete"], ["insert", "Insert"],
  ["home", "Home"], ["end", "End"], ["pageup", "PageUp"], ["pagedown", "PageDown"],
  ["up", "Up"], ["down", "Down"], ["left", "Left"], ["right", "Right"],
])
const modifierOrder = new Map([["ctrl", 0], ["shift", 1], ["alt", 2], ["meta", 2], ["super", 3], ["hyper", 4]])

function plainLine(value: string): string {
  return stripAnsi(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/ +/g, " ").trim()
}

function searchable(value: string): string {
  return plainLine(value).replace(/\s+/gu, " ").normalize("NFC").toLowerCase()
}

/** Format AX chord names for display. This does not validate or register bindings. */
export function formatKeymapKeys(keys: string | readonly string[]): string {
  const sequence = typeof keys === "string" ? [keys] : keys
  return sequence.map((chord) => {
    const parts = chord.toLowerCase().split("+")
    const key = parts.pop()!
    const modifiers = parts.sort((a, b) => (modifierOrder.get(a) ?? 5) - (modifierOrder.get(b) ?? 5)).map((part) => {
      switch (part) {
        case "ctrl": return "Ctrl"
        case "shift": return "Shift"
        case "alt":
        case "meta": return "Alt"
        case "super": return "Super"
        case "hyper": return "Hyper"
        default: return plainLine(part)
      }
    })
    const label = keyLabels.get(key) ?? (/^f\d+$/.test(key) ? key.toUpperCase() : plainLine(key))
    return [...modifiers, label].join("+")
  }).join(" ")
}

/** Preserve snapshot order and duplicates, including shadowed eligible bindings. */
export function createKeymapHelpEntries(
  bindings: readonly KeymapHelpBinding[],
  query = "",
): KeymapHelpEntry[] {
  const needle = searchable(query)
  const entries: KeymapHelpEntry[] = []
  for (const binding of bindings) {
    const id = plainLine(binding.id)
    const description = plainLine(binding.description ?? "") || id
    const shortcut = formatKeymapKeys(binding.keys)
    const haystack = `${id} ${description} ${shortcut} ${binding.keys.join(" ")}`
    if (!needle || searchable(haystack).includes(needle)) entries.push({ id, shortcut, description })
  }
  return entries
}
