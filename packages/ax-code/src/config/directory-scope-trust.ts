import path from "path"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"

/**
 * Remembers a user's "yes, index this broad directory anyway" answer so the
 * startup guard (cli/directory-scope-prompt.ts) only asks once per directory.
 * Keyed by the resolved (realpath'd) absolute path — same normalization the
 * rest of the codebase uses when comparing directories — so a symlink or
 * trailing slash doesn't cause a spurious re-prompt.
 */
export namespace DirectoryScopeTrust {
  const file = path.join(Global.Path.state, "directory-scope-trust.json")

  async function load(): Promise<Record<string, true>> {
    return Filesystem.readJson<Record<string, true>>(file).catch((error) => {
      if (Filesystem.isEnoent(error)) return {}
      throw error
    })
  }

  export async function isTrusted(resolvedDir: string): Promise<boolean> {
    const trusted = await load()
    return trusted[resolvedDir] === true
  }

  export async function trust(resolvedDir: string): Promise<void> {
    const trusted = await load()
    trusted[resolvedDir] = true
    await Filesystem.writeJson(file, trusted)
  }
}
