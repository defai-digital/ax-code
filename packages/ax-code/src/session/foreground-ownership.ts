import { createHash, randomUUID } from "node:crypto"
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { hostname } from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { parseJsonStrict } from "../util/json-value"
import { SessionExecutionContext } from "./execution-context"

// One pinned SQLite binding per session and process. Never inspect an active
// guard through a second connection or unlink its inode.
export namespace ForegroundOwnership {
  export const Journal = SessionExecutionContext.Stamp.extend({
    host: z.string().min(1),
    sessionID: z.string().min(1),
  }).strict()
  export type Journal = z.infer<typeof Journal>
  export const BusyError = NamedError.create("ForegroundOwnershipBusyError", z.object({ sessionID: z.string() }))
  export const OwnershipError = NamedError.create(
    "ForegroundOwnershipError",
    z.object({ message: z.string(), sessionID: z.string() }),
  )

  export type Lease = {
    previous?: Journal
    begin(): Journal
    release(clean: boolean): void
  }
  const held = new Map<string, Lease>()

  export function paths(databasePath: string, sessionID: string) {
    const resolved = path.resolve(databasePath)
    const database = existsSync(resolved)
      ? realpathSync(resolved)
      : path.join(realpathSync(path.dirname(resolved)), path.basename(resolved))
    const directory = database + ".foreground"
    const key = createHash("sha256").update(sessionID).digest("hex")
    return { directory, guard: path.join(directory, key + ".db"), journal: path.join(directory, key + ".json") }
  }

  function syncDirectory(directory: string) {
    // Windows does not expose directory fsync through Node's file API.
    // Rename remains atomic there; durability needs platform qualification.
    if (process.platform === "win32") return
    const fd = openSync(directory, "r")
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
  }

  function readJournal(file: string, sessionID: string, expectedHost = hostname()): Journal | undefined {
    if (!existsSync(file)) return
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.size > 16_384) throw new Error("Invalid foreground generation journal file")
    const journal = Journal.parse(parseJsonStrict(readFileSync(file, "utf8")))
    if (journal.sessionID !== sessionID) throw new Error("Foreground generation journal session mismatch")
    if (journal.host !== expectedHost) throw new Error("Foreground generation journal belongs to another host")
    return journal
  }

  export function acquire(databasePath: string, sessionID: string): Lease {
    let target: ReturnType<typeof paths>
    try {
      target = paths(databasePath, sessionID)
    } catch {
      throw new OwnershipError({ message: "Cannot resolve foreground ownership storage", sessionID })
    }
    if (held.has(target.guard)) throw new BusyError({ sessionID })
    let guard: DatabaseSync | undefined
    try {
      mkdirSync(target.directory, { recursive: true, mode: 0o700 })
      if (!lstatSync(target.directory).isDirectory()) throw new Error("Invalid foreground ownership directory")
      chmodSync(target.directory, 0o700)
      const fd = openSync(target.guard, constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600)
      closeSync(fd)
      if (!lstatSync(target.guard).isFile()) throw new Error("Invalid foreground ownership guard")
      chmodSync(target.guard, 0o600)
      guard = new DatabaseSync(target.guard, { timeout: 0 })
      guard.exec("PRAGMA journal_mode=DELETE")
      guard.exec("BEGIN IMMEDIATE")
      const previous = readJournal(target.journal, sessionID)
      const connection = guard
      let current: Journal | undefined
      let released = false
      const lease: Lease = {
        previous,
        begin() {
          if (released || current)
            throw new OwnershipError({ message: "Foreground generation cannot be restarted", sessionID })
          const journal: Journal = { version: 1, generation: randomUUID(), host: hostname(), sessionID }
          const temporary = target.journal + "." + randomUUID() + ".tmp"
          let fd: number | undefined
          try {
            fd = openSync(temporary, "wx", 0o600)
            writeFileSync(fd, JSON.stringify(journal))
            fsyncSync(fd)
            closeSync(fd)
            fd = undefined
            renameSync(temporary, target.journal)
            syncDirectory(target.directory)
            current = journal
            return journal
          } catch {
            if (fd !== undefined) closeSync(fd)
            if (existsSync(temporary)) unlinkSync(temporary)
            throw new OwnershipError({ message: "Cannot persist foreground generation journal", sessionID })
          }
        },
        release(clean) {
          if (released) return
          released = true
          try {
            if (clean && current) {
              const journal = readJournal(target.journal, sessionID, current.host)
              if (!journal || journal.generation !== current.generation)
                throw new Error("Foreground generation journal changed")
              unlinkSync(target.journal)
              syncDirectory(target.directory)
            }
          } catch {
            throw new OwnershipError({ message: "Cannot finalize foreground generation journal", sessionID })
          } finally {
            try {
              connection.exec("ROLLBACK")
            } finally {
              try {
                connection.close()
              } finally {
                held.delete(target.guard)
              }
            }
          }
        },
      }
      held.set(target.guard, lease)
      return lease
    } catch (error) {
      guard?.close()
      if (error && typeof error === "object" && "errcode" in error && error.errcode === 5)
        throw new BusyError({ sessionID })
      if (OwnershipError.isInstance(error)) throw error
      throw new OwnershipError({ message: "Cannot acquire or validate foreground ownership", sessionID })
    }
  }
}
