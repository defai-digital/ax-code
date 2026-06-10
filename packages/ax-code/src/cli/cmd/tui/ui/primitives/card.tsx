import type { RGBA } from "@opentui/core"
import type { ParentProps } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { EmptyBorder } from "@tui/component/border"

// Full rounded frame (ADR-031 design-system primitive). Plain Unicode box
// drawing, safe in compatible-profile terminals — only gradients/alpha are
// capability-gated, not these glyphs.
export const RoundedBorder = {
  ...EmptyBorder,
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
}

export type CardTone = "default" | "active" | "subtle"

// Rounded-border framed box. Colors come from theme tokens only; an
// explicit accentColor (e.g. the agent color) overrides the tone color.
export function Card(
  props: ParentProps<{ tone?: CardTone; accentColor?: RGBA; flexGrow?: number; flexShrink?: number }>,
) {
  const { theme } = useTheme()
  const borderColor = () => {
    if (props.accentColor) return props.accentColor
    if (props.tone === "active") return theme.borderActive
    if (props.tone === "subtle") return theme.borderSubtle
    return theme.border
  }
  return (
    <box
      border={["top", "right", "bottom", "left"]}
      borderColor={borderColor()}
      customBorderChars={RoundedBorder}
      flexGrow={props.flexGrow}
      flexShrink={props.flexShrink}
    >
      {props.children}
    </box>
  )
}
