import type { Renderable } from "ax-tui"
import { useFocusManager } from "ax-tui/solid"
import { createEffect, onCleanup, type Accessor } from "solid-js"
import { useDialog } from "./dialog"

/** Opt in only dialogs whose controls use native focus, not custom Tab state. */
export function useDialogFocus(root: Accessor<Renderable | undefined>) {
  const dialog = useDialog()
  const owner = dialog.stack.at(-1)
  const focus = useFocusManager()
  createEffect(() => {
    const target = root()
    if (!target || !owner || dialog.stack.at(-1) !== owner || dialog.contextMenu.current) return
    onCleanup(focus.registerScope(target, { modal: true }))
  })
}
