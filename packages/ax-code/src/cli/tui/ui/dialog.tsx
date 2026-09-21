import { useKeyboard, useRenderer, useTerminalDimensions } from "ax-tui/solid"
import { batch, createContext, onCleanup, Show, useContext, type JSX, type ParentProps } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { MouseButton, Renderable, RGBA, type MouseEvent } from "ax-tui"
import { createStore } from "solid-js/store"
import { useToast } from "./toast"
import { RoundedBorder } from "./primitives/card"
import { scheduleMicrotaskTask } from "@tui/util/microtask"
import { Flag } from "@/flag/flag"
import { Selection } from "@tui/util/selection"
import { blurRenderable, focusRenderable, isRenderableAlive, renderableChildren } from "@tui/util/renderable-safety"
import { DIALOG_OVERLAY_VERTICAL_MARGIN, dialogOverlayMaxHeight } from "./dialog-overlay"
import {
  ContextMenuOverlay,
  ContextMenuProvider,
  contextMenuMouseDown,
  createContextMenu,
  useContextMenu,
} from "./context-menu"

export function Dialog(
  props: ParentProps<{
    size?: "medium" | "large"
    onClose: () => void
  }>,
) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const renderer = useRenderer()
  const contextMenu = useContextMenu()

  // Only arm dismissal when a press actually begins on the backdrop and no
  // selection is in progress. A drag that starts inside the dialog never
  // delivers a mousedown to the backdrop, so AX Code TUI routing the terminating
  // mouseup here (to whatever is under the cursor at release) won't dismiss it.
  let armed = false

  return (
    <box
      onMouseDown={() => {
        armed = !renderer.getSelection()
      }}
      onMouseUp={() => {
        if (!armed) return
        armed = false
        // Re-check at release time like the keyboard-escape guard (line 83):
        // don't dismiss if the press turned into a text selection.
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClose?.()
      }}
      width={dimensions().width}
      height={dimensions().height}
      alignItems="center"
      justifyContent="center"
      position="absolute"
      paddingTop={DIALOG_OVERLAY_VERTICAL_MARGIN}
      paddingBottom={DIALOG_OVERLAY_VERTICAL_MARGIN}
      left={0}
      top={0}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        onMouseDown={(e: MouseEvent) => {
          armed = false
          // Right-clicks inside the panel never reach the overlay bubble
          // point, so the context menu is triggered from here directly.
          if (e.button === MouseButton.RIGHT) contextMenuMouseDown(e, contextMenu, renderer)
          e.stopPropagation()
        }}
        onMouseUp={(e: MouseEvent) => {
          armed = false
          e.stopPropagation()
        }}
        width={props.size === "large" ? 80 : 60}
        maxWidth={dimensions().width - 2}
        maxHeight={dialogOverlayMaxHeight(dimensions().height)}
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
        border={["top", "right", "bottom", "left"]}
        customBorderChars={RoundedBorder}
        borderColor={theme.borderActive}
      >
        {props.children}
      </box>
    </box>
  )
}

function init() {
  const [store, setStore] = createStore({
    stack: [] as {
      element: JSX.Element
      onClose?: () => void
    }[],
    size: "medium" as "medium" | "large",
  })

  const renderer = useRenderer()
  const contextMenu = createContextMenu()

  const escapeHandlers = new WeakMap<(typeof store.stack)[number], () => boolean>()

  useKeyboard((evt) => {
    if (evt.defaultPrevented) return
    // An open context menu closes on any key. Escape is swallowed so the
    // dialog behind the menu stays open; other keys continue to their target.
    if (contextMenu.current) {
      contextMenu.close()
      if (evt.name === "escape") {
        evt.preventDefault()
        evt.stopPropagation()
        return
      }
    }
    if (store.stack.length === 0) return
    if ((evt.name === "escape" || (evt.ctrl && evt.name === "c")) && renderer.getSelection()?.getSelectedText()) return
    if (evt.name === "escape" || (evt.ctrl && evt.name === "c")) {
      const current = store.stack.at(-1)
      if (!current) return
      // Global dismissal runs before a picker can handle the key itself.
      // Let only the current dialog consume Escape (for example, to clear
      // search first); Ctrl+C remains an unconditional dismissal.
      if (evt.name === "escape" && escapeHandlers.get(current)?.()) {
        evt.preventDefault()
        evt.stopPropagation()
        return
      }
      setStore("stack", store.stack.slice(0, -1))
      current.onClose?.()
      evt.preventDefault()
      evt.stopPropagation()
      refocus()
    }
  })

  let focus: Renderable | null
  let cancelRefocus: (() => void) | undefined
  function closeItem(item?: { onClose?: () => void }) {
    if (!item?.onClose) return
    try {
      item.onClose()
    } catch {
      // Keep the dialog stack consistent even if a close callback throws.
    }
  }
  function refocus() {
    cancelRefocus?.()
    cancelRefocus = scheduleMicrotaskTask(
      () => {
        if (!isRenderableAlive(focus)) return
        function find(item: Renderable) {
          for (const child of renderableChildren<Renderable>(item, { name: "dialog-refocus-tree" })) {
            if (child === focus) return true
            if (find(child)) return true
          }
          return false
        }
        const found = find(renderer.root)
        if (!found) return
        focusRenderable(focus, { name: "dialog-refocus" })
      },
      {
        name: "dialog-refocus",
      },
    )
  }
  onCleanup(() => cancelRefocus?.())

  return {
    registerEscapeHandler(handler: () => boolean) {
      const item = store.stack.at(-1)
      if (!item) return () => {}
      escapeHandlers.set(item, handler)
      return () => {
        if (escapeHandlers.get(item) === handler) escapeHandlers.delete(item)
      }
    },
    clear() {
      contextMenu.close()
      for (const item of store.stack) {
        closeItem(item)
      }
      batch(() => {
        setStore("size", "medium")
        setStore("stack", [])
      })
      refocus()
    },
    replace(input: any, onClose?: () => void) {
      contextMenu.close()
      if (store.stack.length === 0) {
        focus = renderer.currentFocusedRenderable
        blurRenderable(focus, { name: "dialog-open-blur-current-focus" })
      }
      for (const item of store.stack) {
        closeItem(item)
      }
      setStore("size", "medium")
      setStore("stack", [
        {
          element: input,
          onClose,
        },
      ])
    },
    get stack() {
      return store.stack
    },
    get size() {
      return store.size
    },
    setSize(size: "medium" | "large") {
      setStore("size", size)
    },
    contextMenu,
  }
}

export type DialogContext = ReturnType<typeof init>

const ctx = createContext<DialogContext>()

export function DialogProvider(props: ParentProps) {
  const value = init()
  const renderer = useRenderer()
  const toast = useToast()
  return (
    <ctx.Provider value={value}>
      <ContextMenuProvider value={value.contextMenu}>
        {props.children}
        <box
          position="absolute"
          onMouseDown={(evt: MouseEvent) => contextMenuMouseDown(evt, value.contextMenu, renderer)}
          onMouseUp={
            !Flag.AX_CODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT ? () => Selection.copy(renderer, toast) : undefined
          }
          onMouseScroll={() => value.contextMenu.close()}
        >
          <Show when={value.stack.at(-1)}>
            {(item) => (
              <Dialog onClose={() => value.clear()} size={value.size}>
                {item().element}
              </Dialog>
            )}
          </Show>
        </box>
        <ContextMenuOverlay menu={value.contextMenu} />
      </ContextMenuProvider>
    </ctx.Provider>
  )
}

export function useDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  return value
}
