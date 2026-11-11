import { which, whichAll } from "../../util/which"
import { Process } from "../../util/process"
import { Log } from "../../util/log"
import { selectPreferredCodexBinary } from "./binary"

const log = Log.create({ service: "provider.cli.resolve-binary" })

// A stale standalone `codex` launcher can shadow the newer executable bundled
// with the ChatGPT app. Codex CLI models are version-coupled, so prefer the
// newest executable found on the real PATH rather than failing a selected
// model solely because an older duplicate appears first.
type PendingCliBinary = { promise: Promise<string | null> }
const cliBinaryPending = new Map<string, PendingCliBinary>()

export async function resolveCliBinary(providerID: string, binary: string) {
  const cacheKey = `${providerID}:${binary}`
  // JavaScript does not yield between this lookup and registering `resolving`;
  // after the await, the identity guard below prevents stale cleanup.
  // @scan-suppress race_scan
  const pending = cliBinaryPending.get(cacheKey)
  if (pending) return pending.promise

  const resolving: PendingCliBinary = {
    promise: (async () => {
      const primary = which(binary)
      if (!primary || providerID !== "codex-cli") return primary

      const candidates = [...new Set(whichAll(binary, undefined, { extraDirs: false }))]
      if (candidates.length < 2) return primary

      const inspected = await Promise.all(
        candidates.map(async (candidate) => {
          const result = await Process.run([candidate, "--version"], { timeout: 2_000, nothrow: true }).catch(
            () => undefined,
          )
          return {
            path: candidate,
            version: result?.code === 0 ? `${result.stdout}\n${result.stderr}` : undefined,
          }
        }),
      )
      const selected = selectPreferredCodexBinary(inspected) ?? primary
      if (selected !== primary) {
        log.info("selected newer Codex CLI executable", { primary, selected })
      }
      return selected
    })(),
  }

  cliBinaryPending.set(cacheKey, resolving)
  try {
    return await resolving.promise
  } finally {
    // Deduplicate only concurrent lookups. A permanent cache would retain both
    // misses and stale paths after a provider CLI is installed or upgraded
    // while AX Code is still running.
    if (cliBinaryPending.get(cacheKey) === resolving) cliBinaryPending.delete(cacheKey)
  }
}
