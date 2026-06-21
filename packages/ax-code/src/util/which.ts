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

// Cache which() results to avoid repeated filesystem searches.
// CLI binaries don't move during a session, so this is safe.
const whichCache = new Map<string, { result: string | null; timestamp: number }>()
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

  if (!env) {
    whichCache.set(cmd, { result: resolved, timestamp: Date.now() })
  }

  return resolved
}
