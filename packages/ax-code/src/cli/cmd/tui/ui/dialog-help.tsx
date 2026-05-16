import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "./dialog"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "@tui/context/keybind"
import { For } from "solid-js"

const GROUPS = [
  {
    title: "Session",
    binds: [
      { label: "New session", key: "session_new" },
      { label: "Switch session", key: "session_list" },
      { label: "Compact session", key: "session_compact" },
      { label: "Share session", key: "session_share" },
      { label: "Rename session", key: "session_rename" },
      { label: "Export session", key: "session_export" },
      { label: "Jump to message", key: "session_timeline" },
      { label: "Undo", key: "messages_undo" },
      { label: "Redo", key: "messages_redo" },
    ],
  },
  {
    title: "Navigation",
    binds: [
      { label: "Page up", key: "messages_page_up" },
      { label: "Page down", key: "messages_page_down" },
      { label: "First message", key: "messages_first" },
      { label: "Last message", key: "messages_last" },
      { label: "Toggle sidebar", key: "sidebar_toggle" },
      { label: "Copy message", key: "messages_copy" },
    ],
  },
  {
    title: "Models & Agents",
    binds: [
      { label: "Switch model", key: "model_list" },
      { label: "Cycle model", key: "model_cycle_recent" },
      { label: "Switch agent", key: "agent_list" },
      { label: "Cycle agent", key: "agent_cycle" },
      { label: "Cycle variant", key: "variant_cycle" },
    ],
  },
  {
    title: "Display",
    binds: [
      { label: "Toggle thinking", key: "display_thinking" },
      { label: "Toggle details", key: "tool_details" },
      { label: "Toggle conceal", key: "messages_toggle_conceal" },
      { label: "Toggle scrollbar", key: "scrollbar_toggle" },
    ],
  },
  {
    title: "System",
    binds: [
      { label: "Command palette", key: "command_list" },
      { label: "View status", key: "status_view" },
      { label: "Switch theme", key: "theme_list" },
      { label: "Open editor", key: "editor_open" },
      { label: "Interrupt", key: "session_interrupt" },
      { label: "Exit", key: "app_exit" },
    ],
  },
] as const

export function DialogHelp() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const keybind = useKeybind()

  useKeyboard((evt) => {
    if (evt.name === "return") {
      dialog.clear()
    }
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
    </box>
  )
}
