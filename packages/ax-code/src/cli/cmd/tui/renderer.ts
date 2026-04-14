import { render, type JSX } from "@tui/renderer-adapter/opentui"
import { Clipboard } from "@tui/util/clipboard"
import { Log } from "@/util/log"

const log = Log.create({ service: "tui.renderer" })

export type TuiRenderRoot = () => JSX.Element
export type TuiRenderOptions = NonNullable<Parameters<typeof render>[1]>

export function createTuiRenderOptions(
  input: {
    copySelection?: (text: string) => Promise<void>
  } = {},
): TuiRenderOptions {
  return {
    targetFps: 60,
    gatherStats: false,
    exitOnCtrlC: false,
    useKittyKeyboard: {},
    autoFocus: false,
    openConsoleOnError: false,
    consoleOptions: {
      keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
      onCopySelection: (text) => {
        const copy = input.copySelection ?? Clipboard.copy
        copy(text).catch((error) => {
          log.warn("failed to copy console selection to clipboard", { error })
        })
      },
    },
  }
}

export function renderTui(root: TuiRenderRoot, options?: Parameters<typeof createTuiRenderOptions>[0]) {
  return render(root, createTuiRenderOptions(options))
}
