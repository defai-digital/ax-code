import { engine, PasteEvent, Selection, Timeline, type CliRenderer, type KeyEvent, type TimelineOptions } from "@defai-digital/ax-tui"
import { createContext, createSignal, onCleanup, onMount, useContext } from "solid-js"
import { getOverlayManager, RenderableEvents, type OverlayHandle, type OverlayOptions, type Renderable } from "@defai-digital/ax-tui"
import { getKeymap, type KeymapLayer } from "@defai-digital/ax-tui"

export const RendererContext = createContext<CliRenderer>()

export const useRenderer = () => {
  const renderer = useContext(RendererContext)

  if (!renderer) {
    throw new Error("No renderer found")
  }

  return renderer
}

/** Share renderer routing while disposing only this Solid owner's registrations. */
export const useKeymap = () => {
  const keymap = getKeymap(useRenderer())
  const registrations = new Set<() => void>()
  let disposed = false
  onCleanup(() => {
    disposed = true
    for (const remove of [...registrations]) remove()
  })
  return {
    register(layer: KeymapLayer): () => void {
      if (disposed) throw new Error("Keymap owner is disposed")
      const unregister = keymap.register(layer)
      const target = layer.target
      const remove = () => {
        registrations.delete(remove)
        target?.off(RenderableEvents.DESTROYED, remove)
        unregister()
      }
      registrations.add(remove)
      target?.once(RenderableEvents.DESTROYED, remove)
      return remove
    },
    getActiveBindings: () => keymap.getActiveBindings(),
    get pendingKeys() { return keymap.pendingKeys },
    cancelSequence: () => {
      if (!disposed) keymap.cancelSequence()
    },
  }
}

/** Show owned overlays and close only this Solid owner's handles on cleanup. */
export const useOverlay = (): { show: (content: Renderable, options?: OverlayOptions) => OverlayHandle } => {
  const manager = getOverlayManager(useRenderer())
  const handles = new Set<OverlayHandle>()
  let disposed = false
  onCleanup(() => {
    disposed = true
    for (const handle of [...handles]) handle.close()
    handles.clear()
  })
  return {
    show(content, options) {
      if (disposed) throw new Error("Overlay owner is disposed")
      const handle = manager.show(content, options)
      const forget = () => { handles.delete(scoped) }
      const scoped: OverlayHandle = {
        ...handle,
        close() {
          handles.delete(scoped)
          content.off(RenderableEvents.DESTROYED, forget)
          handle.close()
        },
      }
      if (!content.isDestroyed) {
        handles.add(scoped)
        content.once(RenderableEvents.DESTROYED, forget)
      }
      return scoped
    },
  }
}

export const onResize = (callback: (width: number, height: number) => void) => {
  const renderer = useRenderer()

  onMount(() => {
    renderer.on("resize", callback)
  })

  onCleanup(() => {
    renderer.off("resize", callback)
  })
}

export const useTerminalDimensions = () => {
  const renderer = useRenderer()
  const [terminalDimensions, setTerminalDimensions] = createSignal<{
    width: number
    height: number
  }>({ width: renderer.width, height: renderer.height })

  const callback = (width: number, height: number) => {
    setTerminalDimensions({ width, height })
  }

  onResize(callback)

  return terminalDimensions
}

export interface UseKeyboardOptions {
  /** Include release events - callback receives events with eventType: "release" */
  release?: boolean
}

/**
 * Subscribe to keyboard events.
 *
 * By default, only receives press events (including key repeats with `repeated: true`).
 * Use `options.release` to also receive release events.
 *
 * @example
 * // Basic press handling (includes repeats)
 * useKeyboard((e) => console.log(e.name, e.repeated ? "(repeat)" : ""))
 *
 * // With release events
 * useKeyboard((e) => {
 *   if (e.eventType === "release") keys.delete(e.name)
 *   else keys.add(e.name)
 * }, { release: true })
 */
export const useKeyboard = (callback: (key: KeyEvent) => void, options?: UseKeyboardOptions) => {
  const renderer = useRenderer()
  const keyHandler = renderer.keyInput
  onMount(() => {
    keyHandler.on("keypress", callback)
    if (options?.release) {
      keyHandler.on("keyrelease", callback)
    }
  })

  onCleanup(() => {
    keyHandler.off("keypress", callback)
    if (options?.release) {
      keyHandler.off("keyrelease", callback)
    }
  })
}

export const usePaste = (callback: (event: PasteEvent) => void) => {
  const renderer = useRenderer()
  const keyHandler = renderer.keyInput
  onMount(() => {
    keyHandler.on("paste", callback)
  })

  onCleanup(() => {
    keyHandler.off("paste", callback)
  })
}

/**
 * @deprecated renamed to useKeyboard
 */
export const useKeyHandler = useKeyboard

export const onFocus = (callback: () => void) => {
  const renderer = useRenderer()

  onMount(() => {
    renderer.on("focus", callback)
  })

  onCleanup(() => {
    renderer.off("focus", callback)
  })
}

export const onBlur = (callback: () => void) => {
  const renderer = useRenderer()

  onMount(() => {
    renderer.on("blur", callback)
  })

  onCleanup(() => {
    renderer.off("blur", callback)
  })
}

export const useSelectionHandler = (callback: (selection: Selection) => void) => {
  const renderer = useRenderer()

  onMount(() => {
    renderer.on("selection", callback)
  })

  onCleanup(() => {
    renderer.off("selection", callback)
  })
}

export const useTimeline = (options: TimelineOptions = {}): Timeline => {
  const timeline = new Timeline(options)

  onMount(() => {
    if (options.autoplay !== false) {
      timeline.play()
    }
    engine.register(timeline)
  })

  onCleanup(() => {
    timeline.pause()
    engine.unregister(timeline)
  })

  return timeline
}
