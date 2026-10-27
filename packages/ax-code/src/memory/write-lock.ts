import { FileLock } from "../util/filelock"
import { Lock } from "../util/lock"

/**
 * Serialize a read-modify-write of one memory file across in-process callers
 * (`Lock.write`) and other processes (`FileLock`). Shared by the recorder and
 * the warmup save path so a regenerated scan merges instead of overwriting
 * concurrent records.
 */
export async function withMemoryWriteLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  using _process = await Lock.write(path)
  using _crossProcess = await FileLock.acquire(path)
  return await fn()
}
