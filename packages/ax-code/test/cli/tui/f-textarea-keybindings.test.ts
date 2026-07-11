import { test, expect } from "vitest"
import { textareaKeybindingsForConfig } from "../../../src/cli/cmd/tui/component/textarea-keybindings"
import type { Keybind } from "../../../src/util/keybind"

function key(
  name: string,
  modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean; super?: boolean; leader?: boolean } = {},
): Keybind.Info {
  return {
    name,
    ctrl: modifiers.ctrl ?? false,
    meta: modifiers.meta ?? false,
    shift: modifiers.shift ?? false,
    super: modifiers.super ?? false,
    leader: modifiers.leader ?? false,
  }
}

// Section 23: a `<leader>x` override of an input_* action must not turn the bare
// key destructive while typing. opentui KeyBindings match name+modifiers only,
// so leader combos are dropped before mapping (they can't reach a textarea
// anyway — activating the leader blurs it).
test("leader-prefixed input_* bindings are not mapped into textarea keybindings", () => {
  const bindings = textareaKeybindingsForConfig(
    { input_delete_line: [key("k", { leader: true })] },
    { submit: false, interceptEnter: false },
  )
  expect(bindings.some((b) => b.name === "k")).toBe(false)
})

test("non-leader input_* bindings are still mapped", () => {
  const bindings = textareaKeybindingsForConfig(
    { input_delete_line: [key("k", { ctrl: true })] },
    { submit: false, interceptEnter: false },
  )
  expect(bindings.some((b) => b.name === "k" && b.ctrl && b.action === "delete-line")).toBe(true)
})

// Section 26: Ctrl+- has no kitty keycode on non-kitty terminals (raw mode emits
// 0x1F -> name "_"), so a `ctrl+-` binding also needs a `{name:"_",ctrl:true}`
// alias to fire there.
test("ctrl+- binding emits a ctrl+_ alias for non-kitty terminals", () => {
  const bindings = textareaKeybindingsForConfig(
    { input_undo: [key("-", { ctrl: true })] },
    { submit: false, interceptEnter: false },
  )
  const undo = bindings.filter((b) => b.action === "undo")
  expect(undo.some((b) => b.name === "-" && b.ctrl)).toBe(true)
  expect(undo.some((b) => b.name === "_" && b.ctrl)).toBe(true)
})

// Section 34: rebinding bare Enter to newline must suppress the hardcoded
// Enter->submit injection so the newline binding can take effect.
test("bare Enter->newline suppresses the hardcoded Enter->submit injection", () => {
  const bindings = textareaKeybindingsForConfig(
    { input_newline: [key("return")] },
    { submit: false, interceptEnter: true },
  )
  expect(bindings.some((b) => b.name === "return" && b.action === "submit")).toBe(false)
  expect(bindings.some((b) => b.name === "return" && b.action === "newline")).toBe(true)
})

test("default (modified) input_newline still injects the Enter->submit family", () => {
  const bindings = textareaKeybindingsForConfig(
    { input_newline: [key("return", { shift: true }), key("j", { ctrl: true })] },
    { submit: false, interceptEnter: true },
  )
  // The modified shift+return binding does not conflict with bare Enter->submit.
  expect(bindings.some((b) => b.name === "return" && !b.shift && b.action === "submit")).toBe(true)
  expect(bindings.some((b) => b.name === "kpenter" && b.action === "submit")).toBe(true)
})
