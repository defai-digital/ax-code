import { FileLock } from "../util/filelock"
import { Filesystem } from "../util/filesystem"
import { Lock } from "../util/lock"
import { ConfigPaths } from "./paths"
import { Info } from "./schema"

/** Validate raw JSONC without evaluating environment or file references. */
export function parseConfig(text: string, filepath: string): Info {
  const data = ConfigPaths.parseJsoncOrThrow(text, filepath)
  const parsed = Info.safeParse(data)
  if (parsed.success) return parsed.data
  throw new ConfigPaths.InvalidError({ path: filepath, issues: parsed.error.issues })
}

type EditOptions = { skipUnchanged?: boolean }

export function editConfigFile(
  filepath: string,
  edit: (before: string | undefined) => string,
  options?: EditOptions,
): Promise<Info>
export function editConfigFile(
  filepath: string,
  edit: (before: string | undefined) => string | undefined,
  options?: EditOptions,
): Promise<Info | undefined>
/**
 * Serialize raw JSONC edits and validate before writing. Returning undefined
 * skips the write. Keep lifecycle work outside the synchronous editor;
 * callers refresh runtime state after this promise settles.
 */
export async function editConfigFile(
  filepath: string,
  edit: (before: string | undefined) => string | undefined,
  options: EditOptions = {},
): Promise<Info | undefined> {
  using _inProcess = await Lock.write(filepath)
  using _crossProcess = await FileLock.acquire(filepath)
  const before = await ConfigPaths.readFile(filepath)
  const updated = edit(before)
  if (updated === undefined) return
  const config = parseConfig(updated, filepath)
  if (!options.skipUnchanged || updated !== before) await Filesystem.write(filepath, updated)
  return config
}
