import { Keybind } from "@/util/keybind"
import type { TuiKeyEvent } from "../renderer-adapter/types"

export type Keymap = Record<string, Keybind.Info[]>

export function parseKeymapBindings(input: Record<string, string>): Keymap {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, Keybind.parse(value)]))
}

export function keymapEvent(input: TuiKeyEvent, leader = false) {
  return Keybind.fromEvent(input, leader)
}

export function matchKeymapBinding(keymap: Keymap, name: string, input: TuiKeyEvent, leader = false) {
  const bindings = keymap[name]
  if (!bindings) return false
  const event = keymapEvent(input, leader)
  return bindings.some((binding) => Keybind.match(binding, event))
}

export function printKeymapBinding(keymap: Keymap, name: string) {
  const first = keymap[name]?.at(0)
  if (!first) return ""
  return Keybind.toDisplayString(first, keymap["leader"]?.at(0))
}
