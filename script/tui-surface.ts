/**
 * AX Code TUI's supported intrinsic surface.
 *
 * The vendored core is still a pre-bundled JS dump, so unused renderable
 * *classes* stay in the native/JS chunks. The Solid catalogue and JSX
 * intrinsics must not statically register widgets the TUI never mounts.
 */
export const AX_TUI_JSX = [
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

export const AX_TUI_JSX_UNUSED = ["ascii_font", "tab_select", "select"] as const

export type AxTuiJsx = (typeof AX_TUI_JSX)[number]
