import type { JSX } from "@ax-code/opentui-solid"
import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Spinner } from "@tui/component/spinner"

export type ChipStatus = "running" | "done" | "error" | "warning" | "neutral"

// Status pill on a backgroundElement surface (ADR-031 design-system
// primitive): status dot + optional glyph + label. Completed chips recede
// to muted text; the running/erroring one pops.
export function Chip(props: {
  status?: ChipStatus
  icon?: string
  spinner?: boolean
  onMouseUp?: () => void
  children: JSX.Element
}) {
  const { theme } = useTheme()
  const dotColor = () => {
    switch (props.status) {
      case "running":
        return theme.accent
      case "error":
        return theme.error
      case "warning":
        return theme.warning
      case "done":
        return theme.textMuted
      default:
        return theme.borderSubtle
    }
  }
  const labelColor = () => {
    switch (props.status) {
      case "error":
        return theme.error
      case "done":
        return theme.textMuted
      default:
        return theme.text
    }
  }
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      backgroundColor={theme.backgroundElement}
      paddingLeft={1}
      paddingRight={1}
      onMouseUp={props.onMouseUp}
    >
      <Show
        when={props.spinner}
        fallback={
          <text fg={labelColor()} selectable={false}>
            <span style={{ fg: dotColor() }}>●</span> {props.icon ? `${props.icon} ` : ""}
            {props.children}
          </text>
        }
      >
        <Spinner color={labelColor()}>{props.children}</Spinner>
      </Show>
    </box>
  )
}
