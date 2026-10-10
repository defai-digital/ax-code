import whichPkg from "which"
import path from "path"
import { codeIntelHostMaybe } from "../host"

function searchPath(base: string) {
  const host = codeIntelHostMaybe()
  const extra = host
    ? [
        host.binDir(),
        path.join(host.homeDir(), ".local", "bin"),
        path.join(host.homeDir(), "bin"),
        path.join(host.homeDir(), ".grok", "bin"),
      ]
    : []
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
