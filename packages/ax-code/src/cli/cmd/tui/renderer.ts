import { render, type JSX } from "@opentui/solid"
import { Clipboard } from "@tui/util/clipboard"
import { Log } from "@/util/log"
import { Flag } from "@/flag/flag"

const log = Log.create({ service: "tui.renderer" })

export type TuiRenderRoot = () => JSX.Element
export type TuiRenderOptions = NonNullable<Parameters<typeof render>[1]>

export function createTuiRenderOptions(
  input: {
    copySelection?: (text: string) => Promise<void>
  } = {},
): TuiRenderOptions {
  const advancedTerminal = Flag.AX_CODE_TUI_ADVANCED_TERMINAL

  return {
    targetFps: 60,
    gatherStats: false,
    exitOnCtrlC: false,
    // Keep the default profile compatibility-first. The full OpenTUI
    // terminal setup performs startup capability probes and advanced
    // protocol negotiation on the real TTY, which has been a source of
    // install-time hangs on some terminals. Users who need the old
    // behavior can opt back in with AX_CODE_TUI_ADVANCED_TERMINAL=1.
    testing: !advancedTerminal,
    useThread: advancedTerminal,
    useMouse: advancedTerminal,
    screenMode: advancedTerminal ? "alternate-screen" : "main-screen",
    useKittyKeyboard: advancedTerminal ? {} : null,
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
