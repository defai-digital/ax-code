import { execFileSync } from "child_process"
import path from "path"
import { createRequire } from "module"

/**
 * Force the attached Windows console onto the UTF-8 code page (65001)
 * before anything renders.
 *
 * The TUI writes frames through the native render library, which emits raw
 * UTF-8 bytes straight to the console handle — Node's WriteConsoleW
 * conversion never applies. Under a legacy code page (850, 936, 1252, …)
 * those bytes decode as mojibake: box-drawing borders turn into repeated
 * accented glyphs (issues #307, #315, #338).
 *
 * The installed `ax-code.cmd` shim already runs `chcp 65001`, but that only
 * covers launches that go through the shim. npm shims, direct `node`
 * invocations, editor tasks, and stale launchers all bypass it, so the
 * process checks and sets both code pages directly. The legacy launcher only
 * checks the input code page, which may differ from output after console reuse.
 * The env marker is retained for compatibility, not used as proof that the
 * shared console is still UTF-8. Runtimes without node:ffi use attached chcp.
 */
export const UTF8_CONSOLE_GUARD_ENV = "AX_CODE_UTF8_CONSOLE_DONE"

export type WindowsConsoleCodePages = {
  GetConsoleCP: () => number
  GetConsoleOutputCP: () => number
  SetConsoleCP: (codePage: number) => number
  SetConsoleOutputCP: (codePage: number) => number
}

let nativeConsole: WindowsConsoleCodePages | null | undefined

function loadWindowsConsole(): WindowsConsoleCodePages | null {
  if (nativeConsole !== undefined) return nativeConsole
  try {
    const ffi = createRequire(import.meta.url)("node:ffi") as {
      dlopen: (
        library: string,
        definitions: Record<string, { arguments: string[]; return: string }>,
      ) => { functions: WindowsConsoleCodePages }
    }
    nativeConsole = ffi.dlopen("kernel32.dll", {
      GetConsoleCP: { arguments: [], return: "u32" },
      GetConsoleOutputCP: { arguments: [], return: "u32" },
      SetConsoleCP: { arguments: ["u32"], return: "i32" },
      SetConsoleOutputCP: { arguments: ["u32"], return: "i32" },
    }).functions
  } catch {
    nativeConsole = null
  }
  return nativeConsole
}

export type EnsureWindowsUtf8ConsoleDep = {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  isTTY?: boolean
  exec?: (file: string, args: string[]) => void
  native?: WindowsConsoleCodePages | null
}

export function ensureWindowsUtf8Console(dep: EnsureWindowsUtf8ConsoleDep = {}): boolean {
  const platform = dep.platform ?? process.platform
  if (platform !== "win32") return false
  const env = dep.env ?? process.env
  // Code pages only affect console rendering; piped/redirected output must
  // not be touched (and has no console to configure).
  const isTTY = dep.isTTY ?? (process.stdout.isTTY === true || process.stderr.isTTY === true)
  if (!isTTY) return false
  // Code pages belong to the shared console, not to this process's environment.
  // A previous launch or another attached process may have changed just output.
  // Never trust an inherited "done" marker in place of checking the actual state.
  const native = dep.native === undefined ? loadWindowsConsole() : dep.native
  if (native) {
    try {
      const input = native.GetConsoleCP()
      const output = native.GetConsoleOutputCP()
      if (!input || !output) return false
      if (input !== 65001 && !native.SetConsoleCP(65001)) return false
      if (output !== 65001 && !native.SetConsoleOutputCP(65001)) return false
      if (native.GetConsoleCP() !== 65001 || native.GetConsoleOutputCP() !== 65001) return false
      env[UTF8_CONSOLE_GUARD_ENV] = "1"
      return true
    } catch {
      return false
    }
  }
  const exec =
    dep.exec ??
    ((file: string, args: string[]) => {
      // A hidden, redirected chcp child can report success while operating on
      // a different console. This TTY-only fallback must inherit our console.
      execFileSync(file, args, { stdio: "ignore", windowsHide: false })
    })
  const systemRoot = env["SystemRoot"] ?? env["windir"]
  const chcp = systemRoot ? path.win32.join(systemRoot, "System32", "chcp.com") : "chcp.com"
  try {
    exec(chcp, ["65001"])
  } catch {
    // A locked-down host without chcp.com falls back to whatever the
    // launcher shim configured; rendering may still be wrong, but boot
    // must not fail over a cosmetic setting.
    return false
  }
  env[UTF8_CONSOLE_GUARD_ENV] = "1"
  return true
}
