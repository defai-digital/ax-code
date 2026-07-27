import { ScrollBoxRenderable, TextAttributes } from "@ax-code/opentui-core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { useKeyboard, useTerminalDimensions } from "@ax-code/opentui-solid"
import { useKeybind } from "@tui/context/keybind"
import { createMemo, For } from "solid-js"
import { dialogHelpBodyHeight, dialogHelpGroups } from "./dialog-help-view-model"

// Content is generated from the Keybinds config schema (labels) and the
// resolved keybinds (printed keys, including user overrides), so the dialog
// can no longer drift from the bindings that are actually active.
const GROUPS = dialogHelpGroups()

export function DialogHelp() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const dimensions = useTerminalDimensions()
  const contentRows = createMemo(() => {
    return GROUPS.reduce((rows, group) => {
      const visibleBinds = group.binds.filter((bind) => keybind.print(bind.key)).length
      return rows + 1 + visibleBinds
    }, 0)
  })
  const maxBodyHeight = createMemo(() =>
    dialogHelpBodyHeight({ contentRows: contentRows(), terminalHeight: dimensions().height }),
  )
  let scroll: ScrollBoxRenderable | undefined

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") {
      dialog.clear()
      return
    }
    if (evt.name === "up") scroll?.scrollBy(-1)
    if (evt.name === "down") scroll?.scrollBy(1)
    if (evt.name === "pageup") scroll?.scrollBy(-Math.max(1, maxBodyHeight() - 1))
    if (evt.name === "pagedown") scroll?.scrollBy(Math.max(1, maxBodyHeight() - 1))
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Keyboard Shortcuts
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <scrollbox
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
        maxHeight={maxBodyHeight()}
        viewportOptions={{ paddingRight: 1 }}
        verticalScrollbarOptions={{
          visible: true,
          paddingLeft: 1,
          trackOptions: {
            backgroundColor: theme.backgroundElement,
            foregroundColor: theme.primary,
          },
        }}
      >
        <For each={GROUPS}>
          {(group) => (
            <box>
              <text fg={theme.text}>
                <b>{group.title}</b>
              </text>
              <For each={group.binds.filter((b) => keybind.print(b.key))}>
                {(bind) => (
                  <box flexDirection="row" justifyContent="space-between" gap={2}>
                    <text fg={theme.textMuted}>{bind.label}</text>
                    <text fg={theme.text} flexShrink={0}>
                      {keybind.print(bind.key)}
                    </text>
                  </box>
                )}
              </For>
            </box>
          )}
        </For>
      </scrollbox>
    </box>
  )
}
