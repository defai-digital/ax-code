import { createContext, createEffect, createMemo, createSignal, on, onCleanup, useContext } from "solid-js"
import { useOverlay, useRenderer, useTerminalDimensions } from "ax-tui/solid"
import {
  BoxRenderable,
  MouseButton,
  TextRenderable,
  type EditBufferRenderable,
  type MouseEvent,
  type OverlayHandle,
} from "ax-tui"
import { useTheme } from "@tui/context/theme"
import { useLanguage } from "@tui/context/language"
import { useToast } from "./toast"
import { RoundedBorder } from "./primitives/card"
import { Selection } from "@tui/util/selection"
import { Clipboard } from "@tui/util/clipboard"
import { isRenderableAlive } from "@tui/util/renderable-safety"
import { clipboardTextPaste } from "@tui/component/prompt/view-model"
import { stringWidth } from "@/bun/node-compat"
import {
  contextMenuAvailability,
  contextMenuPlacement,
  scheduledTaskMenuItems,
  type ContextMenuState,
} from "./context-menu-model"

export type { ContextMenuState } from "./context-menu-model"

export type PromptPasteRegistration = {
  focused: () => boolean
  paste: () => void
}

export function createContextMenu() {
  const [state, setState] = createSignal<ContextMenuState>()
  let promptPaste: PromptPasteRegistration | undefined
  return {
    get current() {
      return state()
    },
    /** Reopening at a new cell replaces the previous menu; menus never stack. */
    openAt(next: ContextMenuState) {
      setState(next)
    },
    close() {
      setState(undefined)
    },
    /** The prompt registers its gate-aware paste so the menu reuses it. */
    registerPromptPaste(registration: PromptPasteRegistration) {
      promptPaste = registration
      return () => {
        promptPaste = undefined
      }
    },
    get promptPaste() {
      return promptPaste
    },
  }
}

export type ContextMenu = ReturnType<typeof createContextMenu>

const ctx = createContext<ContextMenu>()

export const ContextMenuProvider = ctx.Provider

export function useContextMenu() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useContextMenu must be used within a ContextMenuProvider")
  }
  return value
}

type ContextMenuRenderer = {
  getSelection: () => { getSelectedText: () => string } | null
  currentFocusedEditor: EditBufferRenderable | null
}

/**
 * Shared right-button trigger for the app root and the dialog overlay bubble
 * points. Any other mouse button just closes an open menu. The event is only
 * consumed when the menu actually opens.
 */
export function contextMenuMouseDown(evt: MouseEvent, menu: ContextMenu, renderer: ContextMenuRenderer) {
  if (evt.button !== MouseButton.RIGHT) {
    if (menu.current) menu.close()
    return
  }
  const availability = contextMenuAvailability({
    hasSelection: Boolean(renderer.getSelection()?.getSelectedText()),
    hasEditor: Boolean(renderer.currentFocusedEditor),
  })
  if (!availability) {
    menu.close()
    return
  }
  evt.preventDefault()
  evt.stopPropagation()
  menu.openAt({ kind: "clipboard", x: evt.x, y: evt.y, ...availability })
}

export function ContextMenuOverlay(props: { menu: ContextMenu }) {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const toast = useToast()
  const uiText = useLanguage().t
  const overlays = useOverlay()
  const [hover, setHover] = createSignal<"copy" | "paste" | "delete">()
  const [taskDeleteArmed, setTaskDeleteArmed] = createSignal(false)

  const view = createMemo(() => {
    const state = props.menu.current
    if (!state) return null
    // Two border columns plus one column of padding on each side.
    if (state.kind === "scheduled-task") {
      const items = scheduledTaskMenuItems(taskDeleteArmed()).map((item) => ({
        id: item.id,
        label: uiText(item.labelKey),
        danger: item.danger,
      }))
      const width = Math.max(...items.map((item) => stringWidth(item.label))) + 4
      const height = items.length + 2
      const placement = contextMenuPlacement({
        x: state.x,
        y: state.y,
        width,
        height,
        termWidth: dimensions().width,
        termHeight: dimensions().height,
      })
      return { kind: "scheduled-task" as const, items, width, height, ...placement }
    }
    const items = [
      { id: "copy" as const, label: uiText("ui.copy"), enabled: state.copy },
      { id: "paste" as const, label: uiText("ui.paste"), enabled: state.paste },
    ]
    const width = Math.max(...items.map((item) => stringWidth(item.label))) + 4
    const height = items.length + 2
    const placement = contextMenuPlacement({
      x: state.x,
      y: state.y,
      width,
      height,
      termWidth: dimensions().width,
      termHeight: dimensions().height,
    })
    return { kind: "clipboard" as const, items, width, height, ...placement }
  })

  // Every open replaces the state object, so keying the reset on state
  // identity also covers reopening the menu on the same row: the armed
  // confirm copy and any hover highlight must never survive across menus.
  createEffect(
    on(
      () => props.menu.current,
      () => {
        setTaskDeleteArmed(false)
        setHover(undefined)
      },
    ),
  )

  // A resize invalidates the cell coordinates the menu was opened at.
  createEffect(
    on(
      () => [dimensions().width, dimensions().height],
      () => props.menu.close(),
      { defer: true },
    ),
  )

  function copy() {
    props.menu.close()
    Selection.copy(renderer, toast)
  }

  function taskDelete() {
    const state = props.menu.current
    if (!state || state.kind !== "scheduled-task") return
    if (!taskDeleteArmed()) {
      setTaskDeleteArmed(true)
      return
    }
    props.menu.close()
    state.onDelete()
  }

  function paste() {
    props.menu.close()
    const promptPaste = props.menu.promptPaste
    if (promptPaste?.focused()) {
      promptPaste.paste()
      return
    }
    const editor = renderer.currentFocusedEditor
    if (!editor || !isRenderableAlive(editor)) {
      toast.show({ message: "No text input is focused", variant: "info" })
      return
    }
    Clipboard.read()
      .then((content) => {
        const text = clipboardTextPaste({ content })
        if (!text) {
          toast.show({ message: "Clipboard has no text to paste", variant: "info" })
          return
        }
        // The async clipboard read may span a focus change; paste only into
        // the editor that was focused when the item was activated.
        if (!isRenderableAlive(editor) || renderer.currentFocusedEditor !== editor) {
          toast.show({ message: "No text input is focused", variant: "info" })
          return
        }
        editor.insertText(text)
      })
      .catch(toast.error)
  }

  // The menu is a positioned, non-capturing overlay: it never takes keyboard
  // focus and the manager clips it to the viewport, raises it above ordinary
  // root content, and owns its destruction. All item state stays imperative
  // because the overlay contract does not allow reparenting mounted JSX.
  let handle: OverlayHandle | undefined
  let rows = new Map<string, TextRenderable>()

  function closeOverlay() {
    handle?.close()
    handle = undefined
    rows = new Map()
  }
  onCleanup(closeOverlay)

  function build(current: NonNullable<ReturnType<typeof view>>) {
    const content = new BoxRenderable(renderer, {
      id: "context-menu",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
      backgroundColor: theme.backgroundPanel,
      borderColor: theme.border,
      border: ["top", "right", "bottom", "left"],
      customBorderChars: RoundedBorder,
      // Item clicks must not bubble to the root handlers and close the menu
      // before mouse-up activates the item.
      onMouseDown: (evt: MouseEvent) => evt.stopPropagation(),
    })
    const next = new Map<string, TextRenderable>()
    function addRow(id: string, label: string, over: () => void, up: () => void) {
      const row = new TextRenderable(renderer, {
        id: `context-menu-${id}`,
        content: label,
        selectable: false,
      })
      row.onMouseOver = over
      row.onMouseOut = () => setHover(undefined)
      row.onMouseUp = up
      content.add(row)
      next.set(id, row)
    }
    if (current.kind === "scheduled-task") {
      for (const item of current.items) {
        addRow(
          item.id,
          item.label,
          () => setHover(item.id),
          () => taskDelete(),
        )
      }
    } else {
      for (const item of current.items) {
        addRow(
          item.id,
          item.label,
          () => {
            if (item.enabled) setHover(item.id)
          },
          () => {
            if (!item.enabled) return
            if (item.id === "copy") copy()
            else paste()
          },
        )
      }
    }
    return { content, rows: next }
  }

  createEffect(() => {
    const current = view()
    closeOverlay()
    if (!current) return
    const built = build(current)
    rows = built.rows
    handle = overlays.show(built.content, {
      width: current.width,
      height: current.height,
      anchor: "top-left",
      offsetX: current.left,
      offsetY: current.top,
      nonCapturing: true,
    })
  })

  createEffect(() => {
    const current = view()
    const hovered = hover()
    if (!current) return
    if (current.kind === "scheduled-task") {
      for (const item of current.items) {
        const row = rows.get(item.id)
        if (!row || row.isDestroyed) continue
        row.fg = item.danger ? theme.error : theme.text
        row.bg = hovered === item.id ? theme.backgroundElement : undefined
      }
      return
    }
    for (const item of current.items) {
      const row = rows.get(item.id)
      if (!row || row.isDestroyed) continue
      row.fg = !item.enabled ? theme.border : hovered === item.id ? theme.text : theme.textMuted
      row.bg = item.enabled && hovered === item.id ? theme.backgroundElement : undefined
    }
  })

  return null
}
