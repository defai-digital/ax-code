import type { TuiKeyEvent } from "../renderer-adapter/types"
import type { FocusOwner } from "./focus-manager"
import { matchKeymapBinding, type Keymap } from "./keymap"

export type CommandDispatchOwner = FocusOwner["type"] | "console"

export type CommandDispatchEntry = {
  value: string
  keybind?: string
  enabled?: boolean
  hidden?: boolean
  owners?: readonly CommandDispatchOwner[]
}

export type CommandDispatchDecision =
  | {
      type: "palette"
      owner: CommandDispatchOwner
    }
  | {
      type: "command"
      owner: CommandDispatchOwner
      value: string
    }
  | {
      type: "ignored"
      owner: CommandDispatchOwner
      reason: string
    }

const DEFAULT_COMMAND_OWNERS = ["app", "prompt", "selection"] as const satisfies CommandDispatchOwner[]
const BLOCKED_OWNERS = new Set<CommandDispatchOwner>(["dialog", "permission", "question", "console"])

export function allowsCommandDispatch(owner: CommandDispatchOwner) {
  return !BLOCKED_OWNERS.has(owner)
}

function commandOwners(entry: CommandDispatchEntry) {
  return entry.owners?.length ? entry.owners : DEFAULT_COMMAND_OWNERS
}

function matchesCommandOwner(entry: CommandDispatchEntry, owner: CommandDispatchOwner) {
  return commandOwners(entry).includes(owner)
}

function isDispatchable(entry: CommandDispatchEntry) {
  return entry.enabled !== false && !entry.hidden && !!entry.keybind
}

export function resolveCommandKeyDispatch(input: {
  owner: FocusOwner | { type: "console" }
  event: TuiKeyEvent
  keymap: Keymap
  leader?: boolean
  paletteKey?: string
  entries: CommandDispatchEntry[]
}): CommandDispatchDecision {
  const owner = input.owner.type
  if (!allowsCommandDispatch(owner)) {
    return {
      type: "ignored",
      owner,
      reason: `${owner} owns input`,
    }
  }

  const paletteKey = input.paletteKey ?? "command_list"
  if (matchKeymapBinding(input.keymap, paletteKey, input.event, input.leader)) {
    return {
      type: "palette",
      owner,
    }
  }

  for (const entry of input.entries) {
    if (!isDispatchable(entry)) continue
    if (!matchesCommandOwner(entry, owner)) continue
    if (matchKeymapBinding(input.keymap, entry.keybind!, input.event, input.leader)) {
      return {
        type: "command",
        owner,
        value: entry.value,
      }
    }
  }

  return {
    type: "ignored",
    owner,
    reason: "no matching command",
  }
}
