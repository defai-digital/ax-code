import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { gaugeParts } from "./format"

export type GaugeTone = "muted" | "warning" | "error"

// Block gauge with percentage, e.g. "▰▰▰▱▱ 42%" (ADR-031 design-system
// primitive). Renders nothing when no view is supplied so callers can pass
// an optional view-model result straight through.
export function Gauge(props: {
  view?: { ratio: number; percent: number; tone: GaugeTone }
  width?: number
  label?: string
}) {
  const { theme } = useTheme()
  const fillColor = () => {
    switch (props.view?.tone) {
      case "error":
        return theme.error
      case "warning":
        return theme.warning
      default:
        return theme.brandGradientStart
    }
  }
  const parts = () => gaugeParts(props.view?.ratio ?? 0, props.width ?? 5)
  return (
    <Show when={props.view}>
      <text fg={theme.textMuted} selectable={false}>
        <span style={{ fg: fillColor() }}>{parts().filled}</span>
        <span style={{ fg: theme.borderSubtle }}>{parts().empty}</span> {props.view!.percent}%
        {props.label ? ` ${props.label}` : ""}
      </text>
    </Show>
  )
}
