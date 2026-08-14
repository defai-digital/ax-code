# `slim-catalogue`

The TUI never mounts `ascii_font`, `tab_select`, or the stock `select`
widget. Those tags stay off the Solid intrinsic catalogue so a new screen
cannot accidentally depend on them. `extend()` still registers custom
renderables (the spinner uses this).

This does **not** tree-shake the corresponding classes out of the pre-bundled
`@ax-code/opentui-core` chunks. That requires vendoring OpenTUI TypeScript
source and rebuilding — not editing hashed JS.

## Contract

1. Solid `baseComponents` / JSX intrinsics match `TUI_OPENTUI_JSX`.
2. `TUI_OPENTUI_JSX_UNUSED` tags are absent from the catalogue and JSX types.
