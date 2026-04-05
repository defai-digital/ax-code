import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { logoLarge } from "@/cli/logo"

// Renders the large "AX-CODE" slant figlet (5 lines, 53 columns) used on the
// TUI welcome screen. Plain text — no shadow-marker parsing — because the
// figlet contains literal underscores/slashes/backslashes that must not be
// interpreted as the `_^~` shading codes used by the compact block-glyph logo.
export function Logo() {
  const { theme } = useTheme()
  return (
    <box>
      <For each={logoLarge}>
        {(line) => (
          <text fg={theme.text} attributes={TextAttributes.BOLD} selectable={false}>
            {line}
          </text>
        )}
      </For>
    </box>
  )
}
