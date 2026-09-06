import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// Visible job/tab token. Apple Terminal, iTerm, and VS Code `${process}` use
// the executed file's basename (proc_pidpath), not process.title and not argv0.
// Homebrew's node is a stub with @loader_path/../lib/libnode, so a flat
// hardlink in ~/.cache/ax-code/libexec/AX-Code dies at dyld and the TUI falls
// back to exec'ing `node`. Brand into runtime/bin/AX-Code + runtime/lib/.
export const AX_CODE_SPAWN_ARGV0 = "AX-Code"

export function brandedNodeName(platform = process.platform) {
  return platform === "win32" ? `${AX_CODE_SPAWN_ARGV0}.exe` : AX_CODE_SPAWN_ARGV0
}

export function brandedNodeCacheDir(env = process.env, homedir = os.homedir()) {
  const base = env.XDG_CACHE_HOME && env.XDG_CACHE_HOME.length > 0 ? env.XDG_CACHE_HOME : path.join(homedir, ".cache")
  return path.join(base, "ax-code", "libexec")
}

export function axCodeJobTitleOsc(title = AX_CODE_SPAWN_ARGV0) {
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

function linkOrCopy(real, branded, fsMod) {
  fsMod.mkdirSync(path.dirname(branded), { recursive: true })
  if (isSameFile(branded, real, fsMod)) return true
  try {
    fsMod.unlinkSync(branded)
  } catch {
    // first time, or the file is busy
  }
  try {
    fsMod.linkSync(real, branded)
    return true
  } catch {
    try {
      fsMod.copyFileSync(real, branded)
      fsMod.chmodSync(branded, 0o755)
      return true
    } catch {
      return false
    }
  }
}

function linkNodeLibs(realNode, branded, fsMod) {
  const brandedDir = path.dirname(branded)
  if (path.basename(brandedDir) !== "bin") return
  const srcLib = path.resolve(path.join(path.dirname(realNode), "..", "lib"))
  if (!fsMod.existsSync(srcLib)) return
  const destLib = path.resolve(path.join(path.dirname(brandedDir), "lib"))
  // Never rewrite the original Node lib directory. A previous sibling-brand
  // path used destLib === srcLib, unlinked Homebrew's libnode, and replaced
  // it with a self-symlink (dyld ELOOP). Isolated runtime/lib only.
  if (destLib === srcLib) return
  fsMod.mkdirSync(destLib, { recursive: true })
  let names
  try {
    names = fsMod.readdirSync(srcLib)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.startsWith("libnode")) continue
    const dest = path.join(destLib, name)
    const src = path.join(srcLib, name)
    try {
      fsMod.unlinkSync(dest)
    } catch {
      // replace any previous link
    }
    try {
      fsMod.symlinkSync(src, dest)
    } catch {
      try {
        fsMod.copyFileSync(src, dest)
      } catch {
        // ignore a single lib copy failure; verifyRunnable will catch it
      }
    }
  }
}

export function verifyBrandedNodeRuns(branded, options = {}) {
  const spawn = options.spawnSync ?? spawnSync
  try {
    const result = spawn(branded, ["-e", "process.stdout.write('ok')"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return result.status === 0 && String(result.stdout ?? "").includes("ok")
  } catch {
    return false
  }
}

/**
 * Path whose basename is AX-Code and that actually runs the given Node.
 * Preference: sibling hardlink (same directory, rpath intact) then
 * cache/runtime/bin/AX-Code with libnode symlinks, then the original path.
 */
export function resolveBrandedNodePath(nodePath, options = {}) {
  const fsMod = options.fs ?? fs
  const platform = options.platform ?? process.platform
  const cacheDir = options.cacheDir ?? brandedNodeCacheDir(options.env, options.homedir)
  const name = brandedNodeName(platform)
  const real = fsMod.realpathSync(nodePath)
  if (path.basename(real) === name) return real

  // Isolated runtime only. Do not hardlink into Node's own bin/ (Homebrew
  // Cellar is shared, and rewriting sibling libs previously destroyed libnode).
  const branded = path.join(cacheDir, "runtime", "bin", name)
  if (linkOrCopy(real, branded, fsMod)) {
    linkNodeLibs(real, branded, fsMod)
    if (options.verify === false || verifyBrandedNodeRuns(branded, options)) return branded
  }
  return real
}

export function brandedSpawnOptions(env = process.env) {
  return {
    stdio: "inherit",
    env,
    argv0: AX_CODE_SPAWN_ARGV0,
  }
}
