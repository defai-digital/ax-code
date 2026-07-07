import { execFileSync } from "child_process"
import path from "path"

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
 * process enforces the code page itself. `chcp.com` sets both the input and
 * output code pages for the console this process is attached to; children
 * (tui backend) share the console, so the guard env var skips redundant
 * spawns in the same process tree.
 */
export const UTF8_CONSOLE_GUARD_ENV = "AX_CODE_UTF8_CONSOLE_DONE"

export type EnsureWindowsUtf8ConsoleDep = {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  isTTY?: boolean
  exec?: (file: string, args: string[]) => void
}

export function ensureWindowsUtf8Console(dep: EnsureWindowsUtf8ConsoleDep = {}): boolean {
  const platform = dep.platform ?? process.platform
  if (platform !== "win32") return false
  const env = dep.env ?? process.env
  if (env[UTF8_CONSOLE_GUARD_ENV] === "1") return false
  // Code pages only affect console rendering; piped/redirected output must
  // not be touched (and has no console to configure).
  const isTTY = dep.isTTY ?? (process.stdout.isTTY === true || process.stderr.isTTY === true)
  if (!isTTY) return false
  const exec =
    dep.exec ??
    ((file: string, args: string[]) => {
      execFileSync(file, args, { stdio: "ignore", windowsHide: true })
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
