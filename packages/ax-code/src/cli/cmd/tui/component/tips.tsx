import { useTheme } from "@tui/context/theme"

const STARTUP_TIP = "Use @ followed by a filename to fuzzy search and attach files"

export function Tips() {
  const theme = useTheme().theme

  return (
    <box flexDirection="row" maxWidth="100%">
      <text flexShrink={0} fg={theme.warning}>
        ● Tip
      </text>
      <text fg={theme.textMuted} flexShrink={1}>
        {" " + STARTUP_TIP}
      </text>
    </box>
  )
}
