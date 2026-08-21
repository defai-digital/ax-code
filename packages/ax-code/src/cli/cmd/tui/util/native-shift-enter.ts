/**
 * Native Shift+Enter detection for terminals that cannot report modified
 * keys (Apple Terminal, Windows console). Mirrors kimi-code / pi-tui's
 * normalizeNativeShiftEnterInput: when a bare CR arrives on such a terminal
 * while the Shift key is physically held — queried at the OS level via FFI —
 * the key is really Shift+Enter (newline), not Enter (submit).
 *
 * Only the detection condition and event shape are unit-tested; the FFI
 * query itself is exercised manually/on-device (see native-shift-enter.test.ts).
 */
import { createRequire } from "node:module"

/**
 * True on terminals that have no way to report Shift+Enter distinctly:
 * Apple Terminal (no Kitty protocol, no modifyOtherKeys — verified by live
 * probe: it does not answer the CSI ? u flags query) and the Windows
 * console, matching kimi-code's shouldDetectNativeShiftEnter.
 */
export function shouldDetectNativeShiftEnter(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (platform === "darwin" && env["TERM_PROGRAM"] === "Apple_Terminal") || platform === "win32"
}

type KeyEventLike = {
  name?: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  super?: boolean
}

/** True when the event is Enter with no modifiers reported by the terminal. */
export function isBareReturnKey(evt: KeyEventLike): boolean {
  return evt.name === "return" && !evt.ctrl && !evt.meta && !evt.shift && !evt.super
}

/**
 * The full native Shift+Enter decision: a bare Enter on a terminal that
 * cannot report modifiers, while the OS says Shift is physically held.
 * `detect` and `shiftPressed` are inputs so this stays pure and testable.
 */
export function isNativeShiftEnter(evt: KeyEventLike, input: { detect: boolean; shiftPressed: boolean }): boolean {
  return isBareReturnKey(evt) && input.detect && input.shiftPressed
}

type ShiftStateQuery = () => boolean

// undefined = not yet attempted; null = unavailable (non-FFI runtime,
// unsupported platform, dlopen failure) — the feature then stays off.
let shiftStateQuery: ShiftStateQuery | null | undefined

function loadShiftStateQuery(): ShiftStateQuery | null {
  if (shiftStateQuery !== undefined) return shiftStateQuery
  shiftStateQuery = null
  try {
    // node:ffi needs --experimental-ffi (the TUI always runs with it); the
    // require throws ERR_UNKNOWN_BUILTIN_MODULE otherwise — caught below.
    const req = createRequire(import.meta.url)
    const ffi = req("node:ffi")
    if (process.platform === "darwin") {
      const { functions } = ffi.dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", {
        CGEventSourceKeyState: { arguments: ["i32", "i32"], return: "bool" },
      })
      // kCGEventSourceStateCombinedSessionState = 0; kVK_Shift = 56,
      // kVK_RightShift = 60. Reading modifier state needs no accessibility
      // permission.
      shiftStateQuery = () => Boolean(functions.CGEventSourceKeyState(0, 56) || functions.CGEventSourceKeyState(0, 60))
    } else if (process.platform === "win32") {
      const { functions } = ffi.dlopen("user32.dll", {
        GetAsyncKeyState: { arguments: ["i32"], return: "i16" },
      })
      // VK_SHIFT = 0x10; the high bit is set while the key is down.
      shiftStateQuery = () => (functions.GetAsyncKeyState(0x10) & 0x8000) !== 0
    }
  } catch {
    shiftStateQuery = null
  }
  return shiftStateQuery
}

/** Current physical Shift-key state at OS level; false when unavailable. */
export function isNativeShiftPressed(): boolean {
  try {
    return loadShiftStateQuery()?.() ?? false
  } catch {
    return false
  }
}
