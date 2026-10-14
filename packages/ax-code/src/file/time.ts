import { Flag } from "@/flag/flag"
import type { SessionID } from "@/session/schema"
import fs from "node:fs"
import { Log } from "../util/log"
import { Instance } from "@/project/instance"

export namespace FileTime {
  const log = Log.create({ service: "file.time" })

  export type Stamp = {
    readonly read: Date
    readonly mtime: number | undefined
    readonly ctime: number | undefined
    readonly size: number | string | undefined
    /**
     * What actually identifies the bytes the model was shown. `mtime`/`ctime`
     * are integer milliseconds, so a rewrite of equal length inside the same
     * millisecond keeps the stamp matching, and a swapped symlink target or
     * hard link keeps the path identical. A recorded field is compared; an
     * absent one counts as unknown, never as a change, so a caller that only
     * has a millisecond stat keeps working.
     */
    readonly mtimeNs?: string
    readonly ctimeNs?: string
    readonly dev?: string
    readonly ino?: string
  }

  interface State {
    reads: Map<SessionID, Map<string, Stamp>>
    locks: Map<string, Promise<void>>
  }

  const state = Instance.state<State>(() => ({
    reads: new Map<SessionID, Map<string, Stamp>>(),
    locks: new Map<string, Promise<void>>(),
  }))

  async function stamp(file: string): Promise<Stamp> {
    // Matches statSync(file, { throwIfNoEntry: false }), which suppresses
    // ENOENT and ENOTDIR — the promise typings omit the option.
    const stat = await fs.promises.stat(file, { bigint: true }).catch((err: NodeJS.ErrnoException) => {
      if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return undefined
      throw err
    })
    const size =
      stat?.size === undefined
        ? undefined
        : stat.size > BigInt(Number.MAX_SAFE_INTEGER)
          ? stat.size.toString()
          : Number(stat.size)
    return {
      read: new Date(),
      // ReadTool records bigint stat milliseconds (truncated, not Date-rounded).
      // Use the same representation for fresh stamps and write admission.
      mtime: stat ? Number(stat.mtimeMs) : undefined,
      ctime: stat ? Number(stat.ctimeMs) : undefined,
      size,
      // Nanoseconds and the file identity: `sameReadSource` (tool/read-text)
      // already treats these as what "same source" means for the read cache,
      // and milliseconds alone cannot separate two writes in one millisecond.
      mtimeNs: stat?.mtimeNs.toString(),
      ctimeNs: stat?.ctimeNs.toString(),
      dev: stat?.dev.toString(),
      ino: stat?.ino.toString(),
    }
  }

  /** True only when both sides recorded the field and they disagree. */
  function identified(left: string | undefined, right: string | undefined) {
    return left !== undefined && right !== undefined && left !== right
  }

  function session(reads: Map<SessionID, Map<string, Stamp>>, sessionID: SessionID) {
    const value = reads.get(sessionID)
    if (value) return value

    const next = new Map<string, Stamp>()
    reads.set(sessionID, next)
    return next
  }

  export async function read(sessionID: SessionID, file: string, observed?: Omit<Stamp, "read">) {
    const reads = state().reads
    log.info("read", { sessionID, file })
    session(reads, sessionID).set(file, observed ? { ...observed, read: new Date() } : await stamp(file))
  }

  export async function get(sessionID: SessionID, file: string) {
    return state().reads.get(sessionID)?.get(file)?.read
  }

  export async function assert(sessionID: SessionID, filepath: string) {
    if (Flag.AX_CODE_DISABLE_FILETIME_CHECK) return

    const time = state().reads.get(sessionID)?.get(filepath)
    if (!time) throw new Error(`You must read file ${filepath} before overwriting it. Use the Read tool first`)

    const next = await stamp(filepath)
    const changed =
      next.mtime !== time.mtime ||
      next.ctime !== time.ctime ||
      next.size !== time.size ||
      identified(next.mtimeNs, time.mtimeNs) ||
      identified(next.ctimeNs, time.ctimeNs) ||
      identified(next.dev, time.dev) ||
      identified(next.ino, time.ino)
    if (!changed) return

    throw new Error(
      `File ${filepath} has been modified since it was last read.\nLast modification: ${new Date(next.mtime ?? next.read.getTime()).toISOString()}\nLast read: ${time.read.toISOString()}\n\nPlease read the file again before modifying it.`,
    )
  }

  export async function withLock<T>(filepath: string, fn: () => Promise<T>): Promise<T> {
    const locks = state().locks
    const previous = locks.get(filepath) ?? Promise.resolve()
    let release!: () => void
    const waitForRelease = new Promise<void>((resolve) => {
      release = resolve
    })
    const current = previous.catch(() => {}).then(() => waitForRelease)
    locks.set(filepath, current)

    await previous.catch(() => {})
    try {
      return await fn()
    } finally {
      release()
      if (locks.get(filepath) === current) locks.delete(filepath)
    }
  }
}
