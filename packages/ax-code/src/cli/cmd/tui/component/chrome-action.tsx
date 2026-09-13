import { createSignal, type JSX } from "solid-js"
import { useTheme } from "@tui/context/theme"

/** Muted chrome control that brightens on hover. Clicks stay on the wrapper box. */
export function ChromeAction(props: { onMouseUp: () => void; children: JSX.Element }) {
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  return (
    <box
      flexShrink={0}
      backgroundColor={hover() ? theme.backgroundElement : undefined}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={props.onMouseUp}
    >
      <text flexShrink={0} fg={hover() ? theme.text : theme.textMuted} selectable={false}>
        {props.children}
      </text>
    </box>
  )
}
