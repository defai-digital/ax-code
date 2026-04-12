import { render } from "@opentui/solid"
import type { CliRendererConfig } from "@opentui/core"

export const TUI_RENDER_TARGET_FPS = 60
export const TUI_RENDER_FRAME_BUDGET_MS = 1000 / TUI_RENDER_TARGET_FPS

type TuiRenderConsoleOptions = NonNullable<CliRendererConfig["consoleOptions"]>
type TuiRenderConsoleKeyBinding = NonNullable<TuiRenderConsoleOptions["keyBindings"]>[number]

export const TUI_RENDER_COPY_SELECTION_KEY_BINDING = {
  name: "y",
  ctrl: true,
  action: "copy-selection",
} as const satisfies TuiRenderConsoleKeyBinding

export type TuiRenderCopySelectionHandler = (text: string) => void | Promise<void>
export type TuiRenderRoot = Parameters<typeof render>[0]
export type TuiRenderOptions = Omit<CliRendererConfig, "consoleOptions"> & {
  consoleOptions: TuiRenderConsoleOptions
}

export function createTuiRenderOptions(input: { onCopySelection: TuiRenderCopySelectionHandler }): TuiRenderOptions {
  return {
    targetFps: TUI_RENDER_TARGET_FPS,
    gatherStats: false,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
    autoFocus: false,
    openConsoleOnError: false,
    externalOutputMode: "passthrough",
    consoleOptions: {
      keyBindings: [TUI_RENDER_COPY_SELECTION_KEY_BINDING],
      onCopySelection: input.onCopySelection,
    },
  }
}

export function renderTui(root: TuiRenderRoot, options: { onCopySelection: TuiRenderCopySelectionHandler }) {
  return render(root, createTuiRenderOptions(options))
}
