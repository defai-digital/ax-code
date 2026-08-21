# `kitty-keyboard-opt-out`

`CliRendererConfig.useKittyKeyboard` documents `null` as the explicit way to
disable Kitty keyboard enablement and parsing. The bundled constructor used a
nullish fallback (`value ?? {}`), which replaced both `undefined` and `null`
with the enabled defaults. As a result, `AX_CODE_TUI_KITTY_KEYBOARD=0` still
enabled the protocol and could alter terminal state despite the opt-out.

## Contract

1. `undefined` keeps the default Kitty keyboard configuration.
2. `null` reaches `buildKittyKeyboardFlags` and the stdin parser unchanged, so
   native flags are zero and Kitty parsing is disabled.

Regression: `script/tui-patches.test.ts` and `pnpm check:tui-patches`.
