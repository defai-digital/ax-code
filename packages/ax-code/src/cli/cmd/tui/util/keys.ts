// Key names that confirm a dialog or menu selection. Terminals variously
// report the Enter key as "return", "linefeed" (ctrl+j), or "kpenter" (numpad
// Enter) — accept all three anywhere a confirm key is handled so behavior
// doesn't depend on how the terminal encodes the key.
export const CONFIRM_KEYS: ReadonlySet<string> = new Set(["return", "linefeed", "kpenter"])

type KeyEventLike = {
  name: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
}

// Legacy terminals cannot report Ctrl+J distinctly: raw mode emits the LF
// byte, which the key parser reports as name "linefeed" (or "\n" via CSI-u)
// with no modifiers. Normalize it to "j"+ctrl so `ctrl+j` bindings — the
// default `input_newline` — actually match. Without this, Ctrl+J fell
// through to the Enter-alias handling and submitted the prompt. (Mirrored in
// component/textarea-keybindings.ts, which emits linefeed/"\n" aliases for
// ctrl+j bindings on the opentui textarea path.)
export function normalizeKeyEventForKeybind<T extends KeyEventLike>(evt: T): T {
  // Ctrl+- on non-kitty terminals: raw mode emits 0x1F, which the parser
  // reports as name "_" with ctrl. Normalize it back to "-" so `ctrl+-`
  // bindings (e.g. the default input_undo) match.
  if (evt.ctrl && evt.name === "_") return { ...evt, name: "-" }
  if (!evt.ctrl && !evt.meta && !evt.shift && (evt.name === "linefeed" || evt.name === "\n")) {
    return { ...evt, name: "j", ctrl: true }
  }
  return evt
}
