import whichPkg from "which"
import path from "path"
import { Global } from "../global"

function searchPath(base: string) {
  const extra = [
    Global.Path.bin,
    path.join(Global.Path.home, ".local", "bin"),
    path.join(Global.Path.home, "bin"),
    path.join(Global.Path.home, ".grok", "bin"),
  ]
  return [...(base ? base.split(path.delimiter) : []), ...extra].filter(Boolean).join(path.delimiter)
}

// Cache successful lookups to avoid repeated filesystem searches. A missing
// executable is deliberately not cached: users commonly install a provider
// CLI while AX Code is already running, and the next provider selection must
// see the new binary immediately.
const whichCache = new Map<string, { result: string; timestamp: number }>()
const WHICH_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  // Only use cache when no custom env is provided (most common case)
  if (!env) {
    const cached = whichCache.get(cmd)
    if (cached && Date.now() - cached.timestamp < WHICH_CACHE_TTL_MS) {
      return cached.result
    }
  }

  const base = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? ""
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    path: searchPath(base),
    pathExt: env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt,
  })
  const resolved = typeof result === "string" ? result : null

  if (!env && resolved) {
    whichCache.set(cmd, { result: resolved, timestamp: Date.now() })
  }

  return resolved
}

// Every match for `cmd` across PATH, in resolution order — the first entry is
// what invoking the bare command name would run. Used to detect stale
// launchers that shadow a freshly installed/upgraded binary.
//
// `extraDirs` controls whether common install directories (`~/.local/bin`,
// etc.) are searched in addition to the real PATH — those aren't part of the
// shell's actual resolution order, so callers that need to report exactly
// what the shell would run (rather than merely detect an install) should
// pass `extraDirs: false`.
export function whichAll(cmd: string, env?: NodeJS.ProcessEnv, opts: { extraDirs?: boolean } = {}): string[] {
  const base = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? ""
  const result = whichPkg.sync(cmd, {
    all: true,
    nothrow: true,
    path: opts.extraDirs === false ? base : searchPath(base),
    pathExt: env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt,
  })
  return Array.isArray(result) ? result : []
}
