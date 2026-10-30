import { KeymapHelpRenderable, RenderableEvents, type KeymapHelpOptions } from "@defai-digital/ax-tui"
import { createRoot, onCleanup, splitProps } from "solid-js"
import type { JSX } from "../../jsx-runtime.js"
import { spread } from "../reconciler.js"
import { useRenderer } from "./hooks.js"

/** Reactive display of caller-provided binding snapshots, with Solid owner cleanup. */
export function KeymapHelp(props: KeymapHelpOptions & {
  ref?: (help: KeymapHelpRenderable) => void
}): JSX.Element {
  const [fixed, reactive] = splitProps(props, ["ref"])
  const help = new KeymapHelpRenderable(useRenderer(), { ...reactive })
  const stopUpdates = createRoot((dispose) => {
    spread(help, reactive)
    return dispose
  })
  help.once(RenderableEvents.DESTROYED, stopUpdates)
  onCleanup(() => {
    stopUpdates()
    help.off(RenderableEvents.DESTROYED, stopUpdates)
    help.destroyRecursively()
  })
  fixed.ref?.(help)
  return help as unknown as JSX.Element
}
