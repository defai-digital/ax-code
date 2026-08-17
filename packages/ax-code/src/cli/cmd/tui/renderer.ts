import { render, type JSX } from "@ax-code/opentui-solid"
import type { CliRendererConfig } from "@ax-code/opentui-core"
import { Clipboard } from "@tui/util/clipboard"
import { Log } from "@/util/log"
import { Flag } from "@/flag/flag"
import { toErrorMessage } from "@/util/error-message"
import {
  clearTuiMainScreen,
  disableTuiMouseTracking,
  flushTuiStdout,
  TUI_TERMINAL_PROGRESS_ACTIVE_SEQUENCE,
  TUI_TERMINAL_PROGRESS_CLEAR_SEQUENCE,
} from "./terminal-cleanup"

const log = Log.create({ service: "tui.renderer" })

export type TuiRenderRoot = () => JSX.Element
export type TuiRenderOptions = CliRendererConfig
export type TuiDestroyRenderer = {
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
  kittyKeyboard?: boolean
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
    // Mouse support is safe in compatible mode — unlike the advanced
    // profile's capability probes, it does not trigger terminal capability
    // probes that can hang. Enable it so footer toggle buttons (Fast-model,
    // Autonomous, Sandbox) are clickable in all terminal profiles.
    useMouse: true,
    // Kitty keyboard is likewise probe-free (a single fire-and-forget flags
    // push), so it is decoupled from the advanced profile and enabled by
    // default — Shift+Enter/Ctrl+Enter newline bindings depend on it.
    useKittyKeyboard: input.kittyKeyboard ?? true,
    screenMode: advancedTerminal ? "alternate-screen" : "main-screen",
    // Terminal title/progress are fire-and-forget OSC escapes written
    // directly to stdout (probe-free, same risk class as the kitty keyboard
    // flags push), so they are decoupled from the advanced profile and
    // enabled by default. Without the title write the terminal tab just
    // shows "node". AX_CODE_DISABLE_TERMINAL_TITLE opts out of both.
    allowTerminalTitle: !terminalTitleDisabled,
  }
}

export function getTuiRenderProfile(): TuiRenderProfile {
  return resolveTuiRenderProfile({
    advancedTerminal: Flag.AX_CODE_TUI_ADVANCED_TERMINAL,
    terminalTitleDisabled: Flag.AX_CODE_DISABLE_TERMINAL_TITLE,
    kittyKeyboard: Flag.AX_CODE_TUI_KITTY_KEYBOARD,
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
    // (Kitty keyboard is the exception: a probe-free flags push, enabled
    // in all profiles unless AX_CODE_TUI_KITTY_KEYBOARD=0.)
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

type TuiSequenceStream = {
  write: (chunk: string) => boolean
  writable?: boolean
  destroyed?: boolean
  isTTY?: boolean
}

function writeTuiSequence(stream: TuiSequenceStream, sequence: string) {
  // Explicit non-TTY (piped/redirected stdout): escape bytes would pollute the
  // redirected output, and the progress keepalive would write every second.
  // Undefined isTTY (test fakes, some real contexts) still writes.
  if (stream.isTTY === false) return false
  if (stream.writable === false || stream.destroyed) return false
  try {
    stream.write(sequence)
    return true
  } catch {
    return false
  }
}

// Control chars (BEL terminates the OSC sequence, ESC would break out of it)
// must never reach the terminal from a session title.
function sanitizeTuiTerminalTitle(title: string) {
  return title.replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
}

// The title is written directly to stdout as an OSC 0 escape instead of
// routing through OpenTUI's native setTerminalTitle — the native write proved
// flaky in the compatible profile (same approach as kimi-code).
export function setTuiTerminalTitle(
  title: string,
  profile: TuiRenderProfile = getTuiRenderProfile(),
  stream: TuiSequenceStream = process.stdout,
) {
  if (!profile.allowTerminalTitle) return false
  return writeTuiSequence(stream, `\x1b]0;${sanitizeTuiTerminalTitle(title)}\x07`)
}

export function clearTuiTerminalTitle(
  profile: TuiRenderProfile = getTuiRenderProfile(),
  stream: TuiSequenceStream = process.stdout,
) {
  return setTuiTerminalTitle("", profile, stream)
}

// OSC 9;4 tab progress indicator (Windows Terminal / ConEmu / Ghostty /
// WezTerm). Shown while the agent is working so busy sessions stand out in
// the tab bar; terminals without support get the braille title spinner
// fallback in app.tsx instead.
export const TUI_TERMINAL_PROGRESS_KEEPALIVE_MS = 1_000

export function supportsTuiTerminalProgress(env: NodeJS.ProcessEnv = process.env) {
  if ((env["WT_SESSION"] ?? "").length > 0) return true
  if (env["ConEmuANSI"] === "ON") return true
  const termProgram = env["TERM_PROGRAM"] ?? ""
  if (termProgram === "ghostty" || termProgram === "WezTerm") return true
  if ((env["TERM"] ?? "") === "xterm-ghostty") return true
  return false
}

export function shouldAnimateTuiTitleSpinner(input: {
  profile: TuiRenderProfile
  terminalTitleEnabled: boolean
  terminalProgressSupported: boolean
  sessionWorking: boolean
}) {
  return (
    input.profile.allowTerminalTitle &&
    input.terminalTitleEnabled &&
    !input.terminalProgressSupported &&
    input.sessionWorking
  )
}

let terminalProgressActive = false
let terminalProgressTimer: ReturnType<typeof setInterval> | undefined

export function setTuiTerminalProgress(
  active: boolean,
  profile: TuiRenderProfile = getTuiRenderProfile(),
  stream: TuiSequenceStream = process.stdout,
  supported: boolean = supportsTuiTerminalProgress(),
) {
  // OSC 9;4 must never reach terminals that lack support: iTerm2/kitty parse
  // plain OSC 9;<text> as a desktop notification, so the activation sequence
  // (plus its 1s keepalive) would surface a bogus "4;3" notification while
  // the agent works. Treat unsupported as inactive, same as the title opt-out.
  if (!profile.allowTerminalTitle || !supported) active = false
  if (active === terminalProgressActive) return false
  terminalProgressActive = active
  if (terminalProgressTimer) {
    clearInterval(terminalProgressTimer)
    terminalProgressTimer = undefined
  }
  if (!active) return writeTuiSequence(stream, TUI_TERMINAL_PROGRESS_CLEAR_SEQUENCE)
  // The indicator times out on some terminals, so re-arm it on an interval
  // (unref'd — teardown always clears it explicitly).
  const wrote = writeTuiSequence(stream, TUI_TERMINAL_PROGRESS_ACTIVE_SEQUENCE)
  if (!wrote) {
    // The write never reached the terminal (degraded stdout), so nothing is
    // showing and no keepalive is running. Roll the dedupe flag back —
    // otherwise it would latch "active" and swallow every future activation
    // for the rest of the process, even after stdout recovers.
    terminalProgressActive = false
    return false
  }
  terminalProgressTimer = setInterval(() => {
    writeTuiSequence(stream, TUI_TERMINAL_PROGRESS_ACTIVE_SEQUENCE)
  }, TUI_TERMINAL_PROGRESS_KEEPALIVE_MS)
  terminalProgressTimer.unref?.()
  return true
}

export async function destroyTuiRenderer(
  renderer: TuiDestroyRenderer,
  profile: TuiRenderProfile = getTuiRenderProfile(),
) {
  let destroyError: unknown
  try {
    setTuiTerminalProgress(false, profile)
  } catch (err) {
    log.warn("failed to clear terminal progress during teardown", {
      error: toErrorMessage(err),
    })
  }
  try {
    clearTuiTerminalTitle(profile)
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
  // Alternate-screen mode restores the prior shell view automatically on exit.
  // Main-screen mode paints on the normal buffer, so explicitly clear the stale
  // TUI frame to avoid a dead full-screen UI lingering above the shell prompt.
  if (profile.screenMode === "main-screen") clearTuiMainScreen()
  await flushTuiStdout()
  if (destroyError) throw destroyError
}

export function renderTui(root: TuiRenderRoot, options?: Parameters<typeof createTuiRenderOptions>[0]) {
  return render(root, createTuiRenderOptions(options))
}
