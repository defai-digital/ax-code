import { RenderableEvents, VirtualListRenderable, type VirtualListOptions } from "@defai-digital/ax-tui"
import { createRoot, onCleanup, splitProps } from "solid-js"
import type { JSX } from "../../jsx-runtime.js"
import { spread } from "../reconciler.js"
import { useRenderer } from "./hooks.js"

/** Solid-owned list; renderItem constructs imperative rows, not already mounted JSX. */
export function VirtualList<T>(props: VirtualListOptions<T> & {
  ref?: (list: VirtualListRenderable<T>) => void
}): JSX.Element {
  const [fixed, reactive] = splitProps(props, ["getKey", "renderItem", "estimateHeight", "overscan", "ref"])
  const list = new VirtualListRenderable(useRenderer(), {
    ...reactive,
    getKey: fixed.getKey,
    renderItem: fixed.renderItem,
    estimateHeight: fixed.estimateHeight,
    overscan: fixed.overscan,
  })
  // External parent/renderer destruction can precede Solid owner disposal.
  // Stop the effect before it can write to freed native layout nodes.
  const stopUpdates = createRoot((dispose) => {
    spread(list, reactive)
    return dispose
  })
  list.once(RenderableEvents.DESTROYED, stopUpdates)
  onCleanup(() => {
    stopUpdates()
    list.off(RenderableEvents.DESTROYED, stopUpdates)
    list.destroyRecursively()
  })
  fixed.ref?.(list)
  return list as unknown as JSX.Element
}
