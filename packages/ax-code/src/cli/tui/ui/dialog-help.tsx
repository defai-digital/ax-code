import { useLanguage } from "@tui/context/language"
import { BoxRenderable, InputRenderable, ScrollBoxRenderable, TextAttributes } from "ax-tui"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { useKeymap, useTerminalDimensions } from "ax-tui/solid"
import { useKeybind } from "@tui/context/keybind"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { dialogHelpBodyHeight, dialogHelpGroups } from "./dialog-help-view-model"
import { dialogHelpSearchGroups } from "./dialog-help-search"
import { focusRenderable, isRenderableAlive } from "@tui/util/renderable-safety"
import { scheduleMicrotaskTask } from "@tui/util/microtask"
import { Keybind } from "@/util/keybind"

// Schema identities, localized labels and resolved keybinds stay in sync.
// Recompute labels when the interface language changes while this dialog is open.

export function DialogHelp() {
  const uiText = useLanguage().t
  const dialog = useDialog()
  const owner = dialog.stack.at(-1)
  const { theme } = useTheme()
  const keybind = useKeybind()
  const keys = useKeymap()
  const [query, setQuery] = createSignal("")
  const [input, setInput] = createSignal<InputRenderable>()
  const [root, setRoot] = createSignal<BoxRenderable>()
  const groups = createMemo(() =>
    dialogHelpSearchGroups(dialogHelpGroups(uiText), keybind.print, query(), (key) =>
      (keybind.all[key] ?? []).map((binding) => Keybind.toDisplayString(binding, keybind.all.leader?.[0])),
    ),
  )
  const dimensions = useTerminalDimensions()
  // Let native layout measure wrapped translated labels. Counting bindings
  // as one row clips multi-line matches in narrow terminals after filtering.
  const maxBodyHeight = createMemo(() =>
    dialogHelpBodyHeight({ contentRows: Number.MAX_SAFE_INTEGER, terminalHeight: dimensions().height }),
  )
  let scroll: ScrollBoxRenderable | undefined

  function clearSearch() {
    const editor = input()
    if (!query() || !isRenderableAlive(editor)) return false
    editor.value = ""
    return true
  }
  // DialogProvider owns Escape/Ctrl+C and the terminal-selection guard.
  // Participate in its clear-before-close path rather than registering a
  // second Escape handler with different ordering or selection semantics.
  onCleanup(dialog.registerEscapeHandler(clearSearch))

  createEffect(() => {
    const target = root()
    if (!target) return
    onCleanup(
      keys.register({
        target,
        scope: "focus-within",
        enabled: () => dialog.stack.at(-1) === owner,
        bindings: [
          { id: "help.close", keys: "enter", handler: () => dialog.clear() },
          { id: "help.up", keys: "up", handler: () => scroll?.scrollBy(-1) },
          { id: "help.down", keys: "down", handler: () => scroll?.scrollBy(1) },
          {
            id: "help.pageup",
            keys: "pageup",
            handler: () => scroll?.scrollBy(-Math.max(1, maxBodyHeight() - 1)),
          },
          {
            id: "help.pagedown",
            keys: "pagedown",
            handler: () => scroll?.scrollBy(Math.max(1, maxBodyHeight() - 1)),
          },
        ],
      }),
    )
  })
  createEffect(on(query, () => scroll?.scrollTo(0)))

  return (
    <box ref={setRoot} paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {uiText("ui.keyboardShortcuts")}
        </text>
        <text
          fg={theme.textMuted}
          onMouseUp={() => {
            if (!clearSearch()) dialog.clear()
          }}
        >
          esc
        </text>
      </box>
      <input
        onInput={(value) => setQuery(value)}
        focusedBackgroundColor={theme.backgroundElement}
        cursorColor={theme.primary}
        focusedTextColor={theme.textMuted}
        placeholder={uiText("common.search")}
        ref={(editor: InputRenderable) => {
          setInput(editor)
          onCleanup(
            scheduleMicrotaskTask(
              () => {
                focusRenderable(editor, { name: "dialog-help-search-focus" })
              },
              { name: "dialog-help-search-focus" },
            ),
          )
        }}
      />
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
        <Show when={groups().length > 0} fallback={<text fg={theme.textMuted}>{uiText("common.noResults")}</text>}>
          <For each={groups()}>
            {(group) => (
              <box>
                <text fg={theme.text}>
                  <b>{group.title}</b>
                </text>
                <For each={group.binds}>
                  {(bind) => (
                    <box flexDirection="row" justifyContent="space-between" gap={2}>
                      <text fg={theme.textMuted}>{bind.label}</text>
                      <text fg={theme.text} flexShrink={0}>
                        {bind.shortcut}
                      </text>
                    </box>
                  )}
                </For>
              </box>
            )}
          </For>
        </Show>
      </scrollbox>
    </box>
  )
}
