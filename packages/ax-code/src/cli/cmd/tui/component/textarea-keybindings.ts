import { createMemo } from "solid-js"
import type { KeyBinding } from "@ax-code/opentui-core"
import { useKeybind } from "../context/keybind"
import { Keybind } from "@/util/keybind"

const TEXTAREA_ACTIONS = [
  "submit",
  "newline",
  "move-left",
  "move-right",
  "move-up",
  "move-down",
  "select-left",
  "select-right",
  "select-up",
  "select-down",
  "line-home",
  "line-end",
  "select-line-home",
  "select-line-end",
  "visual-line-home",
  "visual-line-end",
  "select-visual-line-home",
  "select-visual-line-end",
  "buffer-home",
  "buffer-end",
  "select-buffer-home",
  "select-buffer-end",
  "delete-line",
  "delete-to-line-end",
  "delete-to-line-start",
  "backspace",
  "delete",
  "undo",
  "redo",
  "word-forward",
  "word-backward",
  "select-word-forward",
  "select-word-backward",
  "delete-word-forward",
  "delete-word-backward",
] as const

// Enter key aliases used both for the hardcoded submit bindings below and to
// detect when the user has rebound bare Enter to newline.
const ENTER_KEY_NAMES = new Set(["return", "enter", "linefeed", "kpenter"])

// True when `input_newline` binds a bare (unmodified) Enter, i.e. the user wants
// Enter to insert a newline instead of submitting. Modified combos like
// `shift+return` (the default) don't count — they don't conflict with a bare
// Enter->submit binding.
function newlineMapsEnter(keybinds: Record<string, Keybind.Info[]>): boolean {
  const bindings = keybinds["input_newline"]
  if (!bindings) return false
  return bindings.some(
    (binding) =>
      !binding.leader &&
      !binding.ctrl &&
      !binding.meta &&
      !binding.shift &&
      !binding.super &&
      ENTER_KEY_NAMES.has(binding.name),
  )
}

function mapTextareaKeybindings(
  keybinds: Record<string, Keybind.Info[]>,
  action: (typeof TEXTAREA_ACTIONS)[number],
): KeyBinding[] {
  const configKey = `input_${action.replace(/-/g, "_")}`
  const bindings = keybinds[configKey]
  if (!bindings) return []
  return bindings
    // Leader-prefixed bindings can't reach a focused textarea (activating the
    // leader blurs it), and opentui KeyBindings match name+modifiers only — so a
    // leader combo would collapse to its bare key and fire the action
    // destructively while typing. Drop them here.
    .filter((binding) => !binding.leader)
    .flatMap((binding): KeyBinding[] => {
      const mapped: KeyBinding = {
        name: binding.name,
        ctrl: binding.ctrl || undefined,
        meta: binding.meta || undefined,
        shift: binding.shift || undefined,
        super: binding.super || undefined,
        action,
      }
      // Ctrl+- has no kitty keycode on the default (non-kitty) terminal path:
      // raw mode emits 0x1F, which the parser reports as name "_". Emit an alias
      // so the binding still fires there. (See the mirrored fix in keybind.tsx.)
      if (binding.ctrl && binding.name === "-") {
        return [mapped, { ...mapped, name: "_" }]
      }
      return [mapped]
    })
}

export function useTextareaKeybindings(input: { submit?: boolean; interceptEnter?: boolean } = {}) {
  const keybind = useKeybind()

  return createMemo(() => textareaKeybindingsForConfig(keybind.all, input))
}

export function textareaKeybindingsForConfig(
  keybinds: Record<string, Keybind.Info[]>,
  input: { submit?: boolean; interceptEnter?: boolean } = {},
): KeyBinding[] {
  const submit = input.submit ?? true
  const interceptEnter = input.interceptEnter ?? false
  // Don't force Enter->submit when the user has rebound bare Enter to newline;
  // otherwise the config binding could never take effect.
  const injectEnterSubmit = (submit || interceptEnter) && !newlineMapsEnter(keybinds)

  return [
    ...(injectEnterSubmit
      ? ([
          { name: "return", action: "submit" },
          { name: "enter", action: "submit" },
          { name: "linefeed", action: "submit" },
          // Keypad Enter: intercept it as "submit" too, otherwise OpenTUI's
          // default `kpenter` -> "newline" binding inserts a blank line.
          { name: "kpenter", action: "submit" },
        ] as const)
      : []),
    { name: "return", meta: true, action: "newline" },
    ...TEXTAREA_ACTIONS.flatMap((action) =>
      submit || action !== "submit" ? mapTextareaKeybindings(keybinds, action) : [],
    ),
  ]
}
