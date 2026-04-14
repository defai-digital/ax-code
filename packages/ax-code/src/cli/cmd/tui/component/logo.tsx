import { TextAttributes } from "@tui/renderer-adapter/opentui"
import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { logo } from "@/cli/logo"

// Renders the "AX-CODE" slant figlet (5 lines, 53 columns) used on the TUI
// welcome screen as plain themed text.
export function Logo() {
  const { theme } = useTheme()
  return (
    <box>
      <For each={logo}>
        {(line) => (
          <text fg={theme.text} attributes={TextAttributes.BOLD} selectable={false}>
            {line}
          </text>
        )}
      </For>
    </box>
  )
}
