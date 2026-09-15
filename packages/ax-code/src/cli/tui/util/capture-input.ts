import type { KeyEvent, KeyHandler, PasteEvent } from "ax-tui"

/** Block input before global shortcuts as well as focused renderables. */
export function captureTuiInput(keyInput: KeyHandler, onDismiss: () => void) {
  const consume = (event: KeyEvent | PasteEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  const keypress = (event: KeyEvent) => {
    consume(event)
    if (event.name === "escape" || (event.ctrl && event.name === "c")) onDismiss()
  }
  keyInput.prependListener("keypress", keypress)
  keyInput.prependListener("keyrelease", consume)
  keyInput.prependListener("paste", consume)
  return () => {
    keyInput.off("keypress", keypress)
    keyInput.off("keyrelease", consume)
    keyInput.off("paste", consume)
  }
}
