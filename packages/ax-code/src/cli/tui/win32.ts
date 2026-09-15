import { createRequire } from "module"
import { Log } from "@/util/log"

const log = Log.create({ service: "tui.win32" })

const STD_INPUT_HANDLE = -10
const ENABLE_PROCESSED_INPUT = 0x0001
const require = createRequire(import.meta.url)

type Kernel = {
  symbols: {
    GetStdHandle: (input: number) => unknown
    GetConsoleMode: (handle: unknown, buffer: unknown) => number
    SetConsoleMode: (handle: unknown, mode: number) => number
    FlushConsoleInputBuffer: (handle: unknown) => number
  }
}

type LoadedFfi = {
  kernel: Kernel
  ptr: (input: unknown) => unknown
}

let loaded: LoadedFfi | undefined
let loadAttempted = false

const NODE_KERNEL_SYMBOLS = {
  GetStdHandle: { arguments: ["i32"], return: "pointer" },
  GetConsoleMode: { arguments: ["pointer", "pointer"], return: "i32" },
  SetConsoleMode: { arguments: ["pointer", "u32"], return: "i32" },
  FlushConsoleInputBuffer: { arguments: ["pointer"], return: "i32" },
} as const

const BUN_KERNEL_SYMBOLS = {
  GetStdHandle: { args: ["i32"], returns: "ptr" },
  GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
  SetConsoleMode: { args: ["ptr", "u32"], returns: "i32" },
  FlushConsoleInputBuffer: { args: ["ptr"], returns: "i32" },
} as const

function loadNodeFfi(): LoadedFfi | undefined {
  try {
    const ffi = require("node:ffi") as {
      dlopen: (name: string, symbols: typeof NODE_KERNEL_SYMBOLS) => { functions: Kernel["symbols"] }
      ptr?: (input: unknown) => unknown
    }
    const { functions } = ffi.dlopen("kernel32.dll", NODE_KERNEL_SYMBOLS)
    const ptr = typeof ffi.ptr === "function" ? ffi.ptr : (input: unknown) => input
    return { kernel: { symbols: functions }, ptr }
  } catch {
    return undefined
  }
}

function loadBunFfi(): LoadedFfi | undefined {
  if (!(process.versions as Record<string, string | undefined>).bun) return undefined
  try {
    const ffi = require("bun:ffi") as {
      dlopen: (name: string, symbols: typeof BUN_KERNEL_SYMBOLS) => Kernel
      ptr: (input: unknown) => unknown
    }
    return { kernel: ffi.dlopen("kernel32.dll", BUN_KERNEL_SYMBOLS), ptr: ffi.ptr }
  } catch {
    return undefined
  }
}

function loadFfi() {
  if (loadAttempted) return loaded
  loadAttempted = true
  loaded = loadNodeFfi() ?? loadBunFfi()
  return loaded
}

let k32: Kernel | undefined
let ffi: LoadedFfi | undefined
let warnedNoFfi = false

function load() {
  if (process.platform !== "win32") return false
  try {
    ffi ??= loadFfi()
    k32 ??= ffi?.kernel
  } catch {
    // Reported via the warning below.
  }
  if (!k32 && !warnedNoFfi) {
    // Once per process: if neither node:ffi nor bun:ffi can talk to
    // kernel32, the Ctrl+C console guard no-ops and Ctrl+C may kill the
    // whole console group. Surface that instead of staying silent.
    warnedNoFfi = true
    log.warn("Ctrl+C guard unavailable: Windows console FFI failed to load", {
      runtime: process.versions.bun ? "bun" : "node",
    })
  }
  return !!k32
}

/**
 * Clear ENABLE_PROCESSED_INPUT on the console stdin handle.
 */
export function win32DisableProcessedInput() {
  if (process.platform !== "win32") return
  if (!process.stdin.isTTY) return
  if (!load()) return
  const api = k32
  const ptr = ffi?.ptr
  if (!ptr) return
  if (!api) return

  const handle = api.symbols.GetStdHandle(STD_INPUT_HANDLE)
  const buf = new Uint32Array(1)
  if (api.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return

  const mode = buf[0] ?? 0
  if ((mode & ENABLE_PROCESSED_INPUT) === 0) return
  api.symbols.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)

  return () => {
    const current = new Uint32Array(1)
    if (api.symbols.GetConsoleMode(handle, ptr(current)) === 0) return
    api.symbols.SetConsoleMode(handle, mode)
  }
}

/**
 * Discard any queued console input (mouse events, key presses, etc.).
 */
export function win32FlushInputBuffer() {
  if (process.platform !== "win32") return
  if (!process.stdin.isTTY) return
  if (!load()) return
  const api = k32
  if (!api) return

  const handle = api.symbols.GetStdHandle(STD_INPUT_HANDLE)
  api.symbols.FlushConsoleInputBuffer(handle)
}

let unhook: (() => void) | undefined

/**
 * Keep ENABLE_PROCESSED_INPUT disabled.
 *
 * On Windows, Ctrl+C becomes a CTRL_C_EVENT (instead of stdin input) when
 * ENABLE_PROCESSED_INPUT is set. Various runtimes can re-apply console modes
 * (sometimes on a later tick), and the flag is console-global, not per-process.
 *
 * We combine:
 * - A `setRawMode(...)` hook to re-clear after known raw-mode toggles.
 * - A low-frequency poll as a backstop for native/external mode changes.
 */
export function win32InstallCtrlCGuard() {
  if (process.platform !== "win32") return
  if (!process.stdin.isTTY) return
  if (!load()) return
  const api = k32
  const ptr = ffi?.ptr
  if (!ptr) return
  if (!api) return
  if (unhook) return unhook

  const stdin = process.stdin as any
  const original = stdin.setRawMode

  const handle = api.symbols.GetStdHandle(STD_INPUT_HANDLE)
  const buf = new Uint32Array(1)

  if (api.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return
  const initial = buf[0] ?? 0

  const enforce = () => {
    if (api.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return
    const mode = buf[0] ?? 0
    if ((mode & ENABLE_PROCESSED_INPUT) === 0) return
    api.symbols.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
  }

  // Some runtimes can re-apply console modes on the next tick; enforce twice.
  const later = () => {
    enforce()
    setImmediate(enforce)
  }

  let wrapped: ((mode: boolean) => unknown) | undefined

  if (typeof original === "function") {
    wrapped = (mode: boolean) => {
      const result = original.call(stdin, mode)
      later()
      return result
    }

    stdin.setRawMode = wrapped
  }

  // Ensure it's cleared immediately too (covers any earlier mode changes).
  later()

  const interval = setInterval(enforce, 100)
  interval.unref()

  let done = false
  unhook = () => {
    if (done) return
    done = true

    clearInterval(interval)
    if (wrapped && stdin.setRawMode === wrapped) {
      stdin.setRawMode = original
    }

    api.symbols.SetConsoleMode(handle, initial)
    unhook = undefined
  }

  return unhook
}
