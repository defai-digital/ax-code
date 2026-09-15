import { useTheme } from "@tui/context/theme"

// Keybind hint pair like "esc interrupt" — key in text color, label muted
// (ADR-031 design-system primitive). `active` flips both to the primary
// color for emphasis.
export function KeyHint(props: { keys: string; label: string; active?: boolean; noWrap?: boolean }) {
  const { theme } = useTheme()
  return (
    <text
      fg={props.active ? theme.primary : theme.text}
      selectable={false}
      wrapMode={props.noWrap ? "none" : undefined}
    >
      {props.keys} <span style={{ fg: props.active ? theme.primary : theme.textMuted }}>{props.label}</span>
    </text>
  )
}
