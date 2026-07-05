import { test, expect } from "vitest"
import { textareaKeybindingsForConfig } from "../../../src/cli/cmd/tui/component/textarea-keybindings"
import { isUnmodifiedPromptSubmitKey } from "../../../src/cli/cmd/tui/component/prompt/view-model"
import type { Keybind } from "../../../src/util/keybind"

// Regression coverage for the prompt's Enter handling.
//
// The prompt textarea is configured with `interceptEnter`, mapping the Enter
// family of keys to the textarea's no-op "submit" action so they never insert a
// newline; the real submission then runs from the prompt's global key handler
// (`isPromptSubmitKey`). Before the fix, only `return`/`linefeed` were covered,
// so the numeric-keypad Enter (`kpenter`, reported as a distinct key under the
// kitty keyboard protocol) fell through to OpenTUI's default `kpenter -> newline`
// binding: pressing it inserted a blank line and never submitted.

function key(name: string, modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}): Keybind.Info {
  return {
    name,
    ctrl: modifiers.ctrl ?? false,
    meta: modifiers.meta ?? false,
    shift: modifiers.shift ?? false,
    super: false,
    leader: false,
  }
}

function actionFor(name: string, modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) {
  return textareaKeybindingsForConfig(
    {
      input_newline: [key("return", { shift: true }), key("return", { ctrl: true }), key("j", { ctrl: true })],
    },
    { submit: false, interceptEnter: true },
  ).find(
    (binding) =>
      binding.name === name &&
      Boolean(binding.ctrl) === Boolean(modifiers.ctrl) &&
      Boolean(binding.meta) === Boolean(modifiers.meta) &&
      Boolean(binding.shift) === Boolean(modifiers.shift),
  )?.action
}

function applyPromptKey(
  draft: string,
  name: string,
  modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
) {
  const action = actionFor(name, modifiers)
  if (isUnmodifiedPromptSubmitKey({ name, ...modifiers }) && action === "submit") {
    return { draft, submits: 1 }
  }
  if (action === "newline") return { draft: `${draft}\n`, submits: 0 }
  return { draft, submits: 0 }
}

test("keypad Enter submits instead of inserting a blank line", async () => {
  const result = applyPromptKey("hello", "kpenter")
  expect(actionFor("kpenter")).toBe("submit")
  expect(result.draft).toBe("hello")
  expect(result.submits).toBe(1)
})

test("keypad Enter still submits when the draft already has trailing blank lines", async () => {
  const result = applyPromptKey("hello\n", "kpenter")
  expect(result.draft).toBe("hello\n")
  expect(result.submits).toBe(1)
})

test("main Enter (return) keeps submitting without inserting a newline", async () => {
  const submit = applyPromptKey("hello", "return")
  const newline = applyPromptKey("hello", "return", { shift: true })
  expect(submit).toEqual({ draft: "hello", submits: 1 })
  expect(newline).toEqual({ draft: "hello\n", submits: 0 })
})

test("enter alias submits instead of inserting a blank line", async () => {
  const result = applyPromptKey("hello", "enter")
  expect(actionFor("enter")).toBe("submit")
  expect(result).toEqual({ draft: "hello", submits: 1 })
})
