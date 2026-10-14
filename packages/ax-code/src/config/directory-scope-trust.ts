import path from "path"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { FileLock } from "../util/filelock"
import { Lock } from "../util/lock"

const log = Log.create({ service: "config.directory-scope-trust" })

/**
 * Remembers a user's "yes, index this broad directory anyway" answer so the
 * startup guard (cli/directory-scope-prompt.ts) only asks once per directory.
 * Keyed by the resolved (realpath'd) absolute path — same normalization the
 * rest of the codebase uses when comparing directories — so a symlink or
 * trailing slash doesn't cause a spurious re-prompt.
 */
export namespace DirectoryScopeTrust {
  const file = path.join(Global.Path.state, "directory-scope-trust.json")

  // isTrusted() runs on nearly every CLI startup (see
  // cli/directory-scope-prompt.ts), so a corrupted or unreadable cache file
  // must never throw — this cache is a convenience, and a bad read here
  // must not be able to break every ax-code invocation. Worst case on a
  // swallowed error: the user is asked to confirm again.
  async function load(): Promise<Record<string, true>> {
    return Filesystem.readJson<Record<string, true>>(file).catch((error) => {
      if (!Filesystem.isEnoent(error)) {
        log.warn("failed to read directory-scope trust state; treating as empty", { file, error })
      }
      return {}
    })
  }

  export async function isTrusted(resolvedDir: string): Promise<boolean> {
    const trusted = await load()
    return trusted[resolvedDir] === true
  }

  export async function trust(resolvedDir: string): Promise<void> {
    // Serialize the read-modify-write. Two prompts answered at once — or two
    // ax-code processes starting together — would otherwise each read the
    // pre-write snapshot and the last write would drop the other directory, so
    // the user is asked to confirm a directory they already approved. Use the
    // same in-process Lock + cross-process FileLock pair as the other state
    // writers (e.g. storage). Everything stays fail-soft: a lock timeout or a
    // write error must never break a CLI start.
    try {
      using _lock = await Lock.write(file)
      using _fileLock = await FileLock.acquire(file)
      const trusted = await load()
      trusted[resolvedDir] = true
      await Filesystem.writeJson(file, trusted)
    } catch (error) {
      log.warn("failed to persist directory-scope trust; continuing without remembering this directory", {
        file,
        error,
      })
    }
  }
}
