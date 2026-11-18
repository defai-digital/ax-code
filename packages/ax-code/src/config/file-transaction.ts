import { FileLock } from "../util/filelock"
import { Filesystem } from "../util/filesystem"
import { Lock } from "../util/lock"
import { ConfigPaths } from "./paths"

export type ConfigFileEdit<T> = { text: string; value: T }
export type ConfigFileEditOptions = { skipUnchanged?: boolean }

export function transactConfigFile<T>(
  filepath: string,
  edit: (before: string | undefined) => ConfigFileEdit<T>,
  options?: ConfigFileEditOptions,
): Promise<T>
export function transactConfigFile<T>(
  filepath: string,
  edit: (before: string | undefined) => ConfigFileEdit<T> | undefined,
  options?: ConfigFileEditOptions,
): Promise<T | undefined>
/**
 * Serialize a raw config edit and publish its validated candidate atomically.
 * The synchronous editor owns validation and returns text plus its result;
 * returning undefined skips the write. Refresh runtime state after awaiting
 * this transaction so lifecycle callbacks never run under its file locks.
 */
export async function transactConfigFile<T>(
  filepath: string,
  edit: (before: string | undefined) => ConfigFileEdit<T> | undefined,
  options: ConfigFileEditOptions = {},
): Promise<T | undefined> {
  using _inProcess = await Lock.write(filepath)
  using _crossProcess = await FileLock.acquire(filepath)
  const before = await ConfigPaths.readFile(filepath)
  const candidate = edit(before)
  if (!candidate) return
  if (!options.skipUnchanged || candidate.text !== before) await Filesystem.write(filepath, candidate.text)
  return candidate.value
}
