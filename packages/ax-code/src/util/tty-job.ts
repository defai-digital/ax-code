/**
 * Make this process the TTY's foreground job so Apple Terminal / iTerm show
 * "AX-Code" instead of the wrapper job name ("node" from `npm run dev` / pnpm).
 *
 * OSC titles are not enough: those terminals take the tab's job name from the
 * foreground process group. `npm run dev` leaves npm/node as that group even
 * after the TUI child is branded. setpgid + tcsetpgrp moves the TTY to us.
 */
import { createRequire } from "node:module"

export type TtyJobFfi = {
  setpgid: (pid: number, pgid: number) => number
  tcgetpgrp: (fd: number) => number
  tcsetpgrp: (fd: number, pgid: number) => number
  getpid: () => number
}

function loadTtyJobFfi(): TtyJobFfi | null {
  try {
    const req = createRequire(import.meta.url)
    const ffi = req("node:ffi") as {
      dlopen: (
        name: string,
        symbols: Record<string, { arguments: string[]; return: string }>,
      ) => { functions: TtyJobFfi }
    }
    const lib = process.platform === "darwin" ? "/usr/lib/libc.dylib" : "libc.so.6"
    const { functions } = ffi.dlopen(lib, {
      setpgid: { arguments: ["i32", "i32"], return: "i32" },
      tcgetpgrp: { arguments: ["i32"], return: "i32" },
      tcsetpgrp: { arguments: ["i32", "i32"], return: "i32" },
      getpid: { arguments: [], return: "i32" },
    })
    return functions
  } catch {
    return null
  }
}

export function claimAxCodeForegroundTtyJob(
  input: {
    platform?: NodeJS.Platform
    stdinIsTty?: boolean
    stdoutIsTty?: boolean
    ffi?: TtyJobFfi | null
  } = {},
): boolean {
  const platform = input.platform ?? process.platform
  if (platform === "win32") return false
  const stdinIsTty = input.stdinIsTty ?? process.stdin.isTTY === true
  const stdoutIsTty = input.stdoutIsTty ?? process.stdout.isTTY === true
  if (!stdinIsTty && !stdoutIsTty) return false
  const ffi = input.ffi === undefined ? loadTtyJobFfi() : input.ffi
  if (!ffi) return false
  const fd = stdinIsTty ? 0 : 1
  try {
    const pid = ffi.getpid()
    const previous = ffi.tcgetpgrp(fd)
    if (previous === pid) return true
    if (previous < 0) return false
    ignoreSigTtou()
    if (ffi.setpgid(0, 0) !== 0) return false
    if (ffi.tcsetpgrp(fd, pid) !== 0) {
      ffi.setpgid(0, previous)
      return false
    }
    return true
  } catch {
    return false
  }
}

let sigTtouIgnored = false

function ignoreSigTtou() {
  if (sigTtouIgnored) return
  sigTtouIgnored = true
  process.on("SIGTTOU", () => {})
}
