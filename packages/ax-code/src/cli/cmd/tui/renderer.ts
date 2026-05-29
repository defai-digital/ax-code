import { render, type JSX } from "@opentui/solid"
import type { CliRendererConfig } from "@opentui/core"
import { Clipboard } from "@tui/util/clipboard"
import { Log } from "@/util/log"
import { Flag } from "@/flag/flag"
import { toErrorMessage } from "@/util/error-message"
import { disableTuiMouseTracking, flushTuiStdout } from "./terminal-cleanup"

const log = Log.create({ service: "tui.renderer" })

export type TuiRenderRoot = () => JSX.Element
export type TuiRenderOptions = CliRendererConfig
export type TuiTerminalTitleRenderer = {
  setTerminalTitle: (title: string) => void
}
export type TuiDestroyRenderer = TuiTerminalTitleRenderer & {
  destroy: () => void
}
export type TuiRenderProfile = {
  advancedTerminal: boolean
  profile: "advanced" | "compatible"
  exitOnCtrlC: boolean
  useThread: boolean
  useMouse: boolean
  useKittyKeyboard: boolean
  screenMode: "alternate-screen" | "main-screen"
  allowTerminalTitle: boolean
}

export function resolveTuiRenderProfile(input: {
  advancedTerminal: boolean
  terminalTitleDisabled: boolean
}): TuiRenderProfile {
  const { advancedTerminal, terminalTitleDisabled } = input
  return {
    advancedTerminal,
    profile: advancedTerminal ? "advanced" : "compatible",
    // Keep Ctrl+C routed through ax-code's keybind layer. The app already
    // overloads Ctrl+C for input-clear, selection-copy, and exit flows.
    // Letting OpenTUI destroy the renderer directly bypasses that routing.
    exitOnCtrlC: false,
    useThread: advancedTerminal,
    // Mouse support is safe in compatible mode — unlike kitty keyboard
    // or the native render thread, it does not trigger terminal capability
    // probes that can hang. Enable it so footer toggle buttons (Fast-model,
    // Autonomous, Sandbox) are clickable in all terminal profiles.
    useMouse: true,
    useKittyKeyboard: advancedTerminal,
    screenMode: advancedTerminal ? "alternate-screen" : "main-screen",
    allowTerminalTitle: advancedTerminal && !terminalTitleDisabled,
  }
}

export function getTuiRenderProfile(): TuiRenderProfile {
  return resolveTuiRenderProfile({
    advancedTerminal: Flag.AX_CODE_TUI_ADVANCED_TERMINAL,
    terminalTitleDisabled: Flag.AX_CODE_DISABLE_TERMINAL_TITLE,
  })
}

export function createTuiRenderOptionsFromProfile(
  profile: TuiRenderProfile,
  input: {
    copySelection?: (text: string) => Promise<void>
  } = {},
): TuiRenderOptions {
  return {
    targetFps: 60,
    gatherStats: false,
    // Keep the default profile compatibility-first. The full OpenTUI
    // terminal setup performs startup capability probes and advanced
    // protocol negotiation on the real TTY, which has been a source of
    // install-time hangs on some terminals. Users who need the old
    // behavior can opt back in with AX_CODE_TUI_ADVANCED_TERMINAL=1.
    exitOnCtrlC: profile.exitOnCtrlC,
    useThread: profile.useThread,
    useMouse: profile.useMouse,
    screenMode: profile.screenMode,
    useKittyKeyboard: profile.useKittyKeyboard ? {} : null,
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

export function createTuiRenderOptions(
  input: {
    copySelection?: (text: string) => Promise<void>
  } = {},
): TuiRenderOptions {
  return createTuiRenderOptionsFromProfile(getTuiRenderProfile(), input)
}

export function setTuiTerminalTitle(
  renderer: TuiTerminalTitleRenderer,
  title: string,
  profile: TuiRenderProfile = getTuiRenderProfile(),
) {
  if (!profile.allowTerminalTitle) return false
  renderer.setTerminalTitle(title)
  return true
}

export function clearTuiTerminalTitle(
  renderer: TuiTerminalTitleRenderer,
  profile: TuiRenderProfile = getTuiRenderProfile(),
) {
  return setTuiTerminalTitle(renderer, "", profile)
}

export async function destroyTuiRenderer(
  renderer: TuiDestroyRenderer,
  profile: TuiRenderProfile = getTuiRenderProfile(),
) {
  let destroyError: unknown
  try {
    clearTuiTerminalTitle(renderer, profile)
  } catch (err) {
    log.warn("failed to clear terminal title during teardown", {
      error: toErrorMessage(err),
    })
  }
  try {
    renderer.destroy()
  } catch (err) {
    // Log instead of swallowing — a renderer.destroy() that throws used to
    // mask terminal-corruption bugs because the error rode the unhandled
    // path while cleanup (mouse tracking off, stdout flush) was still
    // started but unobserved. Run cleanup regardless, then rethrow.
    destroyError = err
    log.warn("renderer.destroy() failed during teardown", {
      error: toErrorMessage(err),
    })
  }
  disableTuiMouseTracking()
  await flushTuiStdout()
  if (destroyError) throw destroyError
}

export function renderTui(root: TuiRenderRoot, options?: Parameters<typeof createTuiRenderOptions>[0]) {
  return render(root, createTuiRenderOptions(options))
}
