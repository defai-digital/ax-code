import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useVisualCapability } from "./capability-context"
import { GradientText } from "./gradient-text"

// Horizontal rule (ADR-031 design-system primitive). Plain variant renders
// a subtle border-colored line; the brand variant renders the line with the
// theme's brand gradient ramp (falls back to plain on non-truecolor).
export function Rule(props: { width: number; brand?: boolean }) {
  const { theme } = useTheme()
  const capability = useVisualCapability()
  const line = () => "─".repeat(Math.max(0, props.width))
  return (
    <Show
      when={props.brand && capability.capability().truecolor}
      fallback={
        <text fg={theme.borderSubtle} selectable={false}>
          {line()}
        </text>
      }
    >
      <GradientText
        lines={[line()]}
        from={theme.brandGradientStart}
        to={theme.brandGradientEnd}
        fallback={theme.borderSubtle}
      />
    </Show>
  )
}
