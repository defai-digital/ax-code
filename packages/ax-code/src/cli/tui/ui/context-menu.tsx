import { createContext, createEffect, createMemo, createSignal, For, on, Show, useContext } from "solid-js"
import { useRenderer, useTerminalDimensions } from "ax-tui/solid"
import { MouseButton, type EditBufferRenderable, type MouseEvent } from "ax-tui"
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
      return { kind: "scheduled-task" as const, items, width, ...placement }
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
    return { kind: "clipboard" as const, items, width, ...placement }
  })

  // Every open replaces the state object, so keying the reset on state
  // identity also covers reopening the menu on the same row: the armed
  // confirm copy must never survive across menus.
  createEffect(
    on(
      () => props.menu.current,
      () => setTaskDeleteArmed(false),
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

  return (
    <Show when={view()}>
      {(view) => (
        <box
          position="absolute"
          left={view().left}
          top={view().top}
          width={view().width}
          flexDirection="column"
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={theme.backgroundPanel}
          borderColor={theme.border}
          border={["top", "right", "bottom", "left"]}
          customBorderChars={RoundedBorder}
          // Item clicks must not bubble to the root handlers and close the
          // menu before mouse-up activates the item.
          onMouseDown={(evt: MouseEvent) => evt.stopPropagation()}
        >
          {(() => {
            const current = view()
            if (current.kind === "scheduled-task") {
              return (
                <For each={current.items}>
                  {(item) => (
                    <text
                      fg={item.danger ? theme.error : theme.text}
                      bg={hover() === item.id ? theme.backgroundElement : undefined}
                      selectable={false}
                      onMouseOver={() => setHover(item.id)}
                      onMouseOut={() => setHover(undefined)}
                      onMouseUp={() => taskDelete()}
                    >
                      {item.label}
                    </text>
                  )}
                </For>
              )
            }
            return (
              <For each={current.items}>
                {(item) => (
                  <text
                    fg={!item.enabled ? theme.border : hover() === item.id ? theme.text : theme.textMuted}
                    bg={item.enabled && hover() === item.id ? theme.backgroundElement : undefined}
                    selectable={false}
                    onMouseOver={() => {
                      if (item.enabled) setHover(item.id)
                    }}
                    onMouseOut={() => setHover(undefined)}
                    onMouseUp={() => {
                      if (!item.enabled) return
                      if (item.id === "copy") copy()
                      else paste()
                    }}
                  >
                    {item.label}
                  </text>
                )}
              </For>
            )
          })()}
        </box>
      )}
    </Show>
  )
}
