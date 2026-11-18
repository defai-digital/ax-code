import fs from "node:fs/promises"
import type { BigIntStats } from "node:fs"
import { FileLock } from "../util/filelock"
import { Filesystem } from "../util/filesystem"
import { Lock } from "../util/lock"
import { withRollback } from "../util/rollback"
import { ConfigPaths } from "./paths"

export type ConfigFileEdit<T> = { text: string; value: T }
export type ConfigFileEditOptions = { skipUnchanged?: boolean }
export type ConfigFileRollback<T> = { value: T; rollback: () => Promise<boolean> }

type FileRevision = Pick<BigIntStats, "dev" | "ino" | "size" | "mode" | "mtimeNs" | "ctimeNs">

function sameRevision(left: FileRevision, right: FileRevision): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

async function withConfigFileLock<T>(filepath: string, run: (before: string | undefined) => Promise<T>): Promise<T> {
  using _inProcess = await Lock.write(filepath)
  using _crossProcess = await FileLock.acquire(filepath)
  // Await inside the disposable scope so writes finish before either lock releases.
  return await run(await ConfigPaths.readFile(filepath))
}

async function publishCandidate<T>(
  filepath: string,
  before: string | undefined,
  edit: (before: string | undefined) => ConfigFileEdit<T> | undefined,
  options: ConfigFileEditOptions,
): Promise<{ candidate: ConfigFileEdit<T>; written: boolean } | undefined> {
  const candidate = edit(before)
  if (!candidate) return
  const written = !options.skipUnchanged || candidate.text !== before
  if (written) await Filesystem.write(filepath, candidate.text)
  return { candidate, written }
}

async function restoreConfigFile(filepath: string, before: string | undefined): Promise<void> {
  if (before !== undefined) return Filesystem.write(filepath, before)
  await fs.unlink(filepath).catch((error) => {
    if (Filesystem.isEnoent(error)) return
    throw error
  })
}

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
  return withConfigFileLock(filepath, async (before) => {
    const result = await publishCandidate(filepath, before, edit, options)
    return result?.candidate.value
  })
}

/**
 * Return a one-shot compensating action for the exact file revision published
 * by this transaction. Any intervening write, including identical bytes,
 * releases ownership. Caller lifecycle work stays outside these file locks.
 */
export async function transactConfigFileWithRollback<T>(
  filepath: string,
  edit: (before: string | undefined) => ConfigFileEdit<T> | undefined,
  options: ConfigFileEditOptions = {},
): Promise<ConfigFileRollback<T> | undefined> {
  return withConfigFileLock(filepath, async (before) => {
    const result = await publishCandidate(filepath, before, edit, options)
    if (!result) return
    // If no receipt can be issued, restore before releasing the write locks.
    const revision = result.written
      ? await withRollback(
          () => fs.lstat(filepath, { bigint: true }),
          () => restoreConfigFile(filepath, before),
          "Failed to capture config write ownership and restore config",
        )
      : undefined
    let rollback: Promise<boolean> | undefined
    return {
      value: result.candidate.value,
      rollback: () =>
        (rollback ??= withConfigFileLock(filepath, async (current) => {
          if (!revision || current !== result.candidate.text) return false
          const latest = await fs.lstat(filepath, { bigint: true }).catch((error) => {
            if (Filesystem.isEnoent(error)) return
            throw error
          })
          if (!latest || !sameRevision(revision, latest)) return false
          await restoreConfigFile(filepath, before)
          return true
        })),
    }
  })
}
