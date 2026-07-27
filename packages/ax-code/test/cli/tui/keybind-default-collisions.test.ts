import { describe, test, expect } from "vitest"
import { Keybinds } from "../../../src/config/schema"
import { Keybind } from "../../../src/util/keybind"

// Guards against two keybinds silently shipping the same DEFAULT key. When two
// bindings share a default, every keypress that matches one also matches the
// other, so the pair is only acceptable if the two bindings can never be
// active in the same UI context. New collisions fail this test until they are
// either fixed or allowlisted here with a justification.
//
// Context facts used by the justifications below:
// - Dialog-scoped bindings (session_delete, stash_delete, session_pin_toggle,
//   model_favorite_toggle, model_provider_list, session_rename) are only
//   consumed by the DialogSelect of their own dialog, and global command
//   keybind dispatch is suspended whenever `dialog.stack.length > 0`
//   (dialog-command.tsx), so a dialog binding can never fire together with a
//   global/route binding or with another dialog's binding.
// - input_*/history_* bindings are consumed by the focused prompt textarea
//   (or sequenced explicitly in prompt/index.tsx); the textarea is not
//   focused while a dialog is open.
// - The permission prompt's keyboard handler returns early whenever a dialog
//   is open, so permission_* bindings can never fire together with a dialog
//   binding; while the prompt is visible its handler runs before the prompt
//   textarea and consumes the key (stopPropagation), which is deliberate.
// - app_exit in the prompt is handled in prompt/index.tsx, which checks
//   input_clear first and only exits when the prompt input is empty.
const ALLOWLIST: ReadonlyArray<readonly [a: string, b: string, reason: string]> = [
  [
    "app_exit",
    "input_clear",
    "prompt/index.tsx sequences them deliberately: input_clear fires when the prompt has text, app_exit only exits when the prompt is empty",
  ],
  [
    "app_exit",
    "input_delete",
    "prompt/index.tsx only exits on an empty prompt; with text present the event falls through to the textarea's delete-character binding",
  ],
  [
    "app_exit",
    "session_delete",
    "session_delete is scoped to the session-list dialog; app_exit's prompt handler is unreachable while a dialog is open",
  ],
  [
    "app_exit",
    "stash_delete",
    "stash_delete is scoped to the stash dialog; app_exit's prompt handler is unreachable while a dialog is open",
  ],
  [
    "session_delete",
    "stash_delete",
    "session-list dialog and stash dialog are never open at the same time",
  ],
  [
    "session_delete",
    "input_delete",
    "session_delete is scoped to the session-list dialog; the prompt textarea is not focused while a dialog is open",
  ],
  [
    "stash_delete",
    "input_delete",
    "stash_delete is scoped to the stash dialog; the prompt textarea is not focused while a dialog is open",
  ],
  [
    "model_provider_list",
    "input_line_home",
    "model_provider_list is scoped to the model dialog; the prompt textarea is not focused while a dialog is open",
  ],
  [
    "model_favorite_toggle",
    "session_pin_toggle",
    "model dialog and session-list dialog are never open at the same time",
  ],
  [
    "model_favorite_toggle",
    "input_move_right",
    "model_favorite_toggle is scoped to the model dialog; the prompt textarea is not focused while a dialog is open",
  ],
  [
    "model_favorite_toggle",
    "permission_fullscreen_toggle",
    "the permission prompt's keyboard handler returns early while any dialog (including the model dialog) is open",
  ],
  [
    "session_pin_toggle",
    "input_move_right",
    "session_pin_toggle is scoped to the session-list dialog; the prompt textarea is not focused while a dialog is open",
  ],
  [
    "session_pin_toggle",
    "permission_fullscreen_toggle",
    "the permission prompt's keyboard handler returns early while any dialog (including the session-list dialog) is open",
  ],
  [
    "input_move_right",
    "permission_fullscreen_toggle",
    "while a permission prompt is visible its handler deliberately consumes the key (stopPropagation) before the textarea; same priority as the previous hardcoded ctrl+f",
  ],
  [
    "input_move_up",
    "history_previous",
    "prompt/index.tsx sequences them deliberately: history navigation only triggers at the start of the input buffer, otherwise the cursor moves",
  ],
  [
    "input_move_down",
    "history_next",
    "prompt/index.tsx sequences them deliberately: history navigation only triggers at the end of the input buffer, otherwise the cursor moves",
  ],
  [
    "input_move_left",
    "permission_option_previous",
    "while a permission prompt is visible its handler deliberately consumes the key before the textarea; same priority as the previous hardcoded left/h",
  ],
  [
    "input_move_right",
    "permission_option_next",
    "while a permission prompt is visible its handler deliberately consumes the key before the textarea; same priority as the previous hardcoded right/l",
  ],
]

function pairKey(a: string, b: string) {
  return [a, b].sort().join(" × ")
}

function canonical(info: Keybind.Info) {
  // toString normalizes aliases (enter/return, del/delete) and modifier
  // order, so two different spellings of the same key collide as they would
  // at runtime.
  return Keybind.toString(info)
}

function collisions() {
  const defaults = Keybinds.parse({}) as Record<string, string>
  const byKey = new Map<string, string[]>()
  for (const [name, value] of Object.entries(defaults)) {
    for (const info of Keybind.parse(value)) {
      const key = canonical(info)
      const names = byKey.get(key) ?? []
      names.push(name)
      byKey.set(key, names)
    }
  }
  const pairs: { key: string; a: string; b: string }[] = []
  for (const [key, names] of byKey) {
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        pairs.push({ key, a: names[i], b: names[j] })
      }
    }
  }
  return pairs
}

describe("keybind default collisions", () => {
  test("every default-key collision is allowlisted with a justification", () => {
    const allowed = new Map(ALLOWLIST.map(([a, b, reason]) => [pairKey(a, b), reason]))
    const unexpected = collisions().filter(({ a, b }) => !allowed.has(pairKey(a, b)))
    expect(
      unexpected.map(({ key, a, b }) => `${key}: ${a} × ${b}`),
      "undocumented default-key collisions; fix the defaults or allowlist with a justification",
    ).toEqual([])
  })

  test("every allowlist entry is a real collision (no stale entries)", () => {
    const actual = new Set(collisions().map(({ a, b }) => pairKey(a, b)))
    const stale = ALLOWLIST.filter(([a, b]) => !actual.has(pairKey(a, b)))
    expect(
      stale.map(([a, b]) => pairKey(a, b)),
      "allowlist entries that no longer collide; remove them",
    ).toEqual([])
  })
})
