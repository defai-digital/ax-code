/**
 * AX Code TUI's used OpenTUI surface.
 *
 * The vendored core is still a pre-bundled JS dump, so unused renderable
 * *classes* stay in the native/JS chunks. The Solid catalogue and JSX
 * intrinsics must not statically register widgets the TUI never mounts.
 */
export const TUI_OPENTUI_JSX = [
  "box",
  "text",
  "span",
  "input",
  "textarea",
  "scrollbox",
  "code",
  "diff",
  "line_number",
  "markdown",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "br",
  "a",
] as const

export const TUI_OPENTUI_JSX_UNUSED = ["ascii_font", "tab_select", "select"] as const

export type TuiOpentuiJsx = (typeof TUI_OPENTUI_JSX)[number]
