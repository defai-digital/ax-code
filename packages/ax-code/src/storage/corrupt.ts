import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { backupsDirectoryFor } from "./backup"

// Structural SQLite failures — corruption and not-a-database — that must stay
// fatal and are never retried as contention. Detection mirrors
// Database.isBusyError (db.ts): the node:sqlite driver reports primary result
// codes on `errcode` with `code: "ERR_SQLITE_ERROR"`, so match the numeric
// code (low byte, extended codes keep the primary), a SQLITE_* code string
// for other wrapper variants, and the driver's message text when the numeric
// code was lost in wrapping. Primary codes:
//   - SQLITE_CORRUPT (11): "database disk image is malformed"
//   - SQLITE_NOTADB (26): "file is not a database"
const CORRUPT_PRIMARY_ERRCODES = new Set([11, 26])

export function isCorruptError(error: unknown): boolean {
  const seen = new Set<object>()
  let current = error
  while (current && typeof current === "object" && !seen.has(current) && seen.size < 32) {
    seen.add(current)
    const wrapped = current as { errcode?: unknown; code?: unknown; cause?: unknown }
    if (typeof wrapped.errcode === "number" && CORRUPT_PRIMARY_ERRCODES.has(wrapped.errcode & 0xff)) return true
    if (typeof wrapped.code === "string" && /^SQLITE_(?:CORRUPT|NOTADB)(?:_|$)/.test(wrapped.code)) return true
    if (current instanceof Error) {
      if (current.message.includes("database disk image is malformed")) return true
      if (current.message.includes("file is not a database")) return true
    }
    current = wrapped.cause
  }
  return false
}

export const CorruptDatabaseError = NamedError.create(
  "CorruptDatabaseError",
  z.object({
    message: z.string(),
    file: z.string(),
    backups: z.string(),
  }),
)

export function corruptDatabaseMessage(file: string, backups: string): string {
  return (
    `SQLite database file is corrupt or not a database: ${file}. ` +
    `The file was left untouched — nothing was renamed, overwritten, or deleted. ` +
    `Pre-migration backups live in ${backups}. ` +
    `Run "ax-code doctor" or "ax-code db check" to inspect the file; restore a backup from that directory, or remove the file to start fresh.`
  )
}

/**
 * Raise the actionable CorruptDatabaseError for a database file. The caller is
 * responsible for having left the file untouched; this error never triggers
 * any automatic rename or replacement.
 */
export function raiseCorruptDatabaseError(file: string, cause: unknown): never {
  const backups = backupsDirectoryFor(file)
  throw new CorruptDatabaseError(
    {
      message: corruptDatabaseMessage(file, backups),
      file,
      backups,
    },
    { cause },
  )
}
