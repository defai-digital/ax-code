import { Flag } from "@/flag/flag"

type FlushableStream = {
  write: (chunk: string, callback?: () => void) => boolean
  writable?: boolean
  destroyed?: boolean
}

type RawModeStream = {
  isTTY?: boolean
  setRawMode?: (mode: boolean) => unknown
}

export const TUI_MOUSE_TRACKING_DISABLE_SEQUENCE = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l"
// xterm modifyOtherKeys mode 2. Terminals without Kitty keyboard protocol
// support (xterm.js/VS Code, iTerm2 legacy mode, mintty) cannot report
// Shift+Enter distinctly until the app opts in with this sequence; the
// modified key then arrives as CSI 27;<mod>;<code>~, which the stdin parser
// already decodes (Shift+Enter -> "return"+shift -> input_newline).
// Fire-and-forget: terminals that don't know the sequence ignore it. (The
// native renderer setup additionally pushes mode 1 on its own.)
export const TUI_MODIFY_OTHER_KEYS_ENABLE_SEQUENCE = "\x1b[>4;2m"
export const TUI_MODIFY_OTHER_KEYS_DISABLE_SEQUENCE = "\x1b[>4;0m"
// The native renderer owns Kitty keyboard push/pop during normal operation.
// Keep the protocol pop here for crash recovery, where native teardown may not
// run. resetTuiTerminalState includes it only when AX Code enabled Kitty input.
export const TUI_KITTY_KEYBOARD_POP_SEQUENCE = "\x1b[<u"
// OSC 9;4 tab progress (Windows Terminal / ConEmu / Ghostty / WezTerm).
// Shown while the agent works; cleared on teardown/crash so the indicator
// never lingers on a dead tab. Kept here (not renderer.ts) so the crash
// reset can emit it without a terminal-cleanup -> renderer import cycle.
export const TUI_TERMINAL_PROGRESS_ACTIVE_SEQUENCE = "\x1b]9;4;3\x07"
export const TUI_TERMINAL_PROGRESS_CLEAR_SEQUENCE = "\x1b]9;4;0\x07"
// OSC 0 with an empty title. A crashed TUI must not leave a stale "AX Code | ..."
// tab title (possibly with a frozen spinner frame) on a dead terminal.
export const TUI_TERMINAL_TITLE_CLEAR_SEQUENCE = "\x1b]0;\x07"

export function createTuiTerminalCrashResetSequence(input: { kittyKeyboard?: boolean } = {}) {
  const kittyKeyboard = input.kittyKeyboard ?? true
  // The native renderer always enables xterm modifyOtherKeys mode 1 during
  // setup, even when AX Code's mode-2 enhancement is disabled, so crash
  // recovery must always turn it off. Native clean teardown owns the normal
  // mode-0 reset.
  return `${TUI_MOUSE_TRACKING_DISABLE_SEQUENCE}${TUI_MODIFY_OTHER_KEYS_DISABLE_SEQUENCE}${kittyKeyboard ? TUI_KITTY_KEYBOARD_POP_SEQUENCE : ""}\x1b[?2004l\x1b[?25h\x1b[?1049l${TUI_TERMINAL_PROGRESS_CLEAR_SEQUENCE}${TUI_TERMINAL_TITLE_CLEAR_SEQUENCE}`
}

export const TUI_TERMINAL_CRASH_RESET_SEQUENCE = createTuiTerminalCrashResetSequence()

// Cursor-home + erase-entire-display. In main-screen mode the renderer paints
// directly on the normal terminal buffer (no alternate screen to restore on
// exit), so the last TUI frame lingers after teardown and looks like a still
// running session. Emitting this on clean exit clears the stale frame. See #261.
export const TUI_MAIN_SCREEN_CLEAR_SEQUENCE = "\x1b[H\x1b[2J"

export function disableTuiMouseTracking(stream: FlushableStream = process.stdout) {
  if (stream.writable === false || stream.destroyed) return false
  try {
    stream.write(TUI_MOUSE_TRACKING_DISABLE_SEQUENCE)
    return true
  } catch {
    return false
  }
}

export function clearTuiMainScreen(stream: FlushableStream = process.stdout) {
  if (stream.writable === false || stream.destroyed) return false
  try {
    stream.write(TUI_MAIN_SCREEN_CLEAR_SEQUENCE)
    return true
  } catch {
    return false
  }
}

export function restoreTuiStdinMode(stream: RawModeStream = process.stdin) {
  if (!stream.isTTY || typeof stream.setRawMode !== "function") return false
  try {
    stream.setRawMode(false)
    return true
  } catch {
    return false
  }
}

export function resetTuiTerminalState(
  input: {
    stdout?: FlushableStream
    stdin?: RawModeStream
    // Injectable for tests. Defaults to the same flag the renderer profile
    // uses (renderer.ts reads it via getTuiRenderProfile); duplicated here to
    // avoid a terminal-cleanup -> renderer import cycle.
    screenMode?: "alternate-screen" | "main-screen"
    kittyKeyboard?: boolean
  } = {},
) {
  const stdinRestored = restoreTuiStdinMode(input.stdin)
  const stdout = input.stdout ?? process.stdout
  if (stdout.writable === false || stdout.destroyed) return stdinRestored
  const screenMode = input.screenMode ?? (Flag.AX_CODE_TUI_ADVANCED_TERMINAL ? "alternate-screen" : "main-screen")
  try {
    // Alternate-screen restores the prior shell view via \x1b[?1049l above.
    // Main-screen paints on the normal buffer, so the crash path must also
    // erase the last frame — otherwise a dead full-screen TUI lingers above
    // the shell prompt (the clean-exit path does the same in renderer.ts).
    const clear = screenMode === "main-screen" ? TUI_MAIN_SCREEN_CLEAR_SEQUENCE : ""
    const reset = createTuiTerminalCrashResetSequence({
      kittyKeyboard: input.kittyKeyboard ?? Flag.AX_CODE_TUI_KITTY_KEYBOARD,
    })
    stdout.write(reset + clear)
    return true
  } catch {
    return stdinRestored
  }
}

// Cap how long teardown waits for the final stdout write. If the stream is in
// a degraded state (broken pipe that hasn't surfaced as `destroyed` yet) the
// write callback never fires and the exit promise would otherwise hang forever,
// leaving the terminal stuck in raw/alt-screen mode.
const FLUSH_TIMEOUT_MS = 500

export function flushTuiStdout(stream: FlushableStream = process.stdout) {
  if (stream.writable === false || stream.destroyed) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    // Safety net: resolve even if the write callback is lost.
    const timer = setTimeout(done, FLUSH_TIMEOUT_MS)
    timer.unref?.()
    try {
      stream.write("", done)
    } catch {
      done()
    }
  })
}
