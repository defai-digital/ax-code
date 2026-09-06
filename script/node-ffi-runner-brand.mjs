import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Visible job/tab token for source-mode Node. Must match the TUI OSC title
// (packages/ax-code/src/util/terminal-title.ts). Apple Terminal.app's tab
// falls back to the executable basename when OSC 0 clears the icon title;
// iTerm2 "Job" is that basename too. Spawning a hardlink named AX-Code is
// what makes the tab stop saying "node".
export const AX_CODE_SPAWN_ARGV0 = "AX-Code"

export function brandedNodeName(platform = process.platform) {
  return platform === "win32" ? `${AX_CODE_SPAWN_ARGV0}.exe` : AX_CODE_SPAWN_ARGV0
}

export function brandedNodeCacheDir(env = process.env, homedir = os.homedir()) {
  const base = env.XDG_CACHE_HOME && env.XDG_CACHE_HOME.length > 0 ? env.XDG_CACHE_HOME : path.join(homedir, ".cache")
  return path.join(base, "ax-code", "libexec")
}

export function axCodeJobTitleOsc(title = AX_CODE_SPAWN_ARGV0) {
  // OSC 1 = icon/tab, OSC 2 = window. Do not use OSC 0: Apple Terminal.app
  // treats it as "set window title and clear tab title", after which the tab
  // shows the job name ("node" for source-mode launches).
  return `\x1b]1;${title}\x07\x1b]2;${title}\x07`
}

function isSameFile(left, right, fsMod) {
  try {
    const a = fsMod.statSync(left)
    const b = fsMod.statSync(right)
    return a.dev === b.dev && a.ino === b.ino
  } catch {
    return false
  }
}

/**
 * Return a filesystem path whose basename is AX-Code and that executes the
 * same Node binary as `nodePath`. Hardlink when possible (preserves macOS
 * code signature); copy when the cache is on another device; fall back to
 * the original path if both fail.
 */
export function resolveBrandedNodePath(nodePath, options = {}) {
  const fsMod = options.fs ?? fs
  const platform = options.platform ?? process.platform
  const cacheDir = options.cacheDir ?? brandedNodeCacheDir(options.env, options.homedir)
  const real = fsMod.realpathSync(nodePath)
  const branded = path.join(cacheDir, brandedNodeName(platform))
  if (path.basename(real) === brandedNodeName(platform) || real === branded) return real
  fsMod.mkdirSync(cacheDir, { recursive: true })
  if (isSameFile(branded, real, fsMod)) return branded
  try {
    fsMod.unlinkSync(branded)
  } catch {
    // No previous link, or it is in use; link/copy below will fail loudly
    // and the caller falls back to nodePath.
  }
  try {
    fsMod.linkSync(real, branded)
    return branded
  } catch {
    try {
      fsMod.copyFileSync(real, branded)
      fsMod.chmodSync(branded, 0o755)
      return branded
    } catch {
      return real
    }
  }
}

export function brandedSpawnOptions(env = process.env) {
  return {
    stdio: "inherit",
    env,
    argv0: AX_CODE_SPAWN_ARGV0,
  }
}
