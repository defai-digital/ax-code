# `slim-catalogue`

The TUI never mounts `ascii_font`, `tab_select`, or the stock `select`
widget. Those tags stay off the Solid intrinsic catalogue so a new screen
cannot accidentally depend on them. `extend()` still registers custom
renderables (the spinner uses this).

The catalogue and JSX types are maintained in `solid/source/`. The core
classes remain public exports for compatibility; reducing the intrinsic
catalogue does not remove those classes from `ax-tui`.

## Contract

1. Solid `baseComponents` / JSX intrinsics match `AX_TUI_JSX`.
2. `AX_TUI_JSX_UNUSED` tags are absent from the catalogue and JSX types.
