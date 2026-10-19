import fs from "node:fs"
import path from "node:path"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { DurableStoragePolicy, formatStorageBytes } from "./policy"

// Pre-migration database backups (Batch 3 session-database protection).
//
// Before journal migrations run against an existing database whose schema
// version is behind, a consistent copy is taken via `VACUUM INTO` into a temp
// file in the backups directory, then atomically renamed into place (same
// volume as the database, so the rename cannot tear). A failed backup only
// warns — startup continues — and backups are rotated to the newest
// `DurableStoragePolicy.preMigrationBackupsKept` per database.

const log = Log.create({ service: "storage.backup" })

/** Backups for one database live in a "backups" directory next to the database file. */
export function backupsDirectoryFor(dbPath: string): string {
  return path.join(path.dirname(dbPath), "backups")
}

function backupPrefix(dbPath: string): string {
  return path.basename(dbPath) + "."
}

// The tag portion of a backup filename: exactly one backupTag() stamp
// (YYYYMMDDThhmmssSSSZ) plus ".bak". Matching the full shape — not just the
// prefix and suffix — keeps an operator's hand-placed copy like
// "ax-code.db.bak" out of the rotation list, where pruneBackups would
// silently delete it.
const BACKUP_TAG_SUFFIX = /^\d{8}T\d{9}Z\.bak$/

export function isBackupFileFor(dbPath: string, name: string): boolean {
  const prefix = backupPrefix(dbPath)
  if (!name.startsWith(prefix)) return false
  return BACKUP_TAG_SUFFIX.test(name.slice(prefix.length))
}

// UTC, fixed-width, lexicographically sortable: 20261016T093000123Z
function backupTag(now: number): string {
  return new Date(now).toISOString().replace(/[-:]/g, "").replace(".", "")
}

export type DatabaseBackup = {
  file: string
  path: string
  sizeBytes: number
  mtimeMs: number
}

/** Existing backups for one database, newest first (test/doctor observable). */
export function listDatabaseBackups(input: { dbPath: string }): DatabaseBackup[] {
  const directory = backupsDirectoryFor(input.dbPath)
  let names: string[]
  try {
    names = fs.readdirSync(directory)
  } catch {
    return []
  }
  const backups: DatabaseBackup[] = []
  for (const name of names) {
    if (!isBackupFileFor(input.dbPath, name)) continue
    const file = path.join(directory, name)
    try {
      const stat = fs.statSync(file)
      if (!stat.isFile()) continue
      backups.push({ file: name, path: file, sizeBytes: stat.size, mtimeMs: stat.mtimeMs })
    } catch {
      // Raced away between readdir and stat — skip it.
    }
  }
  return backups.sort((a, b) => b.mtimeMs - a.mtimeMs || b.file.localeCompare(a.file))
}

function pruneBackups(dbPath: string) {
  const stale = listDatabaseBackups({ dbPath }).slice(DurableStoragePolicy.preMigrationBackupsKept)
  for (const backup of stale) {
    try {
      fs.rmSync(backup.path)
    } catch (error) {
      log.warn("failed to prune old pre-migration backup", { file: backup.path, error: toErrorMessage(error) })
    }
  }
}

export type PreMigrationBackupResult = {
  took: boolean
  reason?: "not-pending" | "empty" | "size-cap" | "failed"
  backupPath?: string
  error?: string
}

/**
 * Take one pre-migration backup of a database via the caller's open
 * connection (`vacuumInto` runs `VACUUM INTO <target>`, which produces a
 * transactionally consistent copy including WAL content). Never throws: a
 * failed backup is logged as a warning and startup continues — the schema
 * migration still runs either way.
 */
export function takePreMigrationBackup(input: {
  dbPath: string
  fileBytes: number
  migrationPending: boolean
  // False for a brand-new database whose sqlite_master is still empty. The
  // startup pragmas already materialize a header page before this decision,
  // so file size alone cannot distinguish "fresh" from "existing".
  existingSchema: boolean
  vacuumInto: (target: string) => void
  now?: () => number
}): PreMigrationBackupResult {
  if (!input.migrationPending) return { took: false, reason: "not-pending" }
  // A brand-new database has nothing to lose.
  if (!input.existingSchema) return { took: false, reason: "empty" }
  if (input.fileBytes > DurableStoragePolicy.preMigrationBackupMaxSourceBytes) {
    log.warn("skipping pre-migration backup: database exceeds size cap", {
      file: input.dbPath,
      size: formatStorageBytes(input.fileBytes),
      cap: formatStorageBytes(DurableStoragePolicy.preMigrationBackupMaxSourceBytes),
    })
    return { took: false, reason: "size-cap" }
  }

  const directory = backupsDirectoryFor(input.dbPath)
  const base = `${backupPrefix(input.dbPath)}${backupTag((input.now ?? Date.now)())}`
  // The temp name must not derive from wall-clock time alone: two processes
  // backing up the same database in the same millisecond would otherwise share
  // one temp file, and VACUUM INTO refuses (or worse, tears) an existing
  // target. The final name stays tag-only — same-millisecond backups of one
  // database are interchangeable snapshots and the rename is atomic.
  // @scan-suppress security_scan - directory is the database backup directory; base is a basename/tag and the suffix is generated locally.
  const temporary = path.join(directory, `${base}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`)
  const final = path.join(directory, `${base}.bak`)
  try {
    fs.mkdirSync(directory, { recursive: true })
    input.vacuumInto(temporary)
    fs.renameSync(temporary, final)
  } catch (error) {
    log.warn("pre-migration backup failed; continuing without it", {
      file: input.dbPath,
      error: toErrorMessage(error),
    })
    try {
      fs.rmSync(temporary, { force: true })
    } catch {
      // Best-effort cleanup of the partial temp file.
    }
    return { took: false, reason: "failed", error: toErrorMessage(error) }
  }
  log.info("pre-migration backup taken", { file: input.dbPath, backup: final })
  pruneBackups(input.dbPath)
  return { took: true, backupPath: final }
}

// Journal-migration pending check. Drizzle decides which journal entries to
// run by name: an entry runs when its name is missing from
// `__drizzle_migrations`, whatever its timestamp (a migration merged from a
// branch can be older than the newest applied one). Mirror that set check so
// the backup is never skipped for a migration that is about to run.
//
// Returns undefined when the table predates the `name` column. Drizzle
// rewrites such a table in place before migrating, so callers treat it as
// pending.
export function readAppliedMigrationNames(client: {
  prepare(sql: string): { all(): unknown[] }
}): Set<string> | undefined {
  try {
    const rows = client.prepare("SELECT name FROM __drizzle_migrations").all() as Array<{ name?: unknown }>
    return new Set(rows.flatMap((row) => (typeof row.name === "string" ? [row.name] : [])))
  } catch (error) {
    const message = toErrorMessage(error)
    // A database with no migration table yet has applied nothing.
    if (message.includes("no such table")) return new Set()
    if (message.includes("no such column")) return undefined
    throw error
  }
}

export function journalMigrationPending(applied: Set<string> | undefined, entries: ReadonlyArray<{ name: string }>) {
  if (entries.length === 0) return false
  if (!applied) return true
  return entries.some((entry) => !applied.has(entry.name))
}

/** True when the database already holds at least one table (i.e. it is not brand-new). */
export function readSchemaTableCount(client: { prepare(sql: string): { get(): unknown } }): number {
  const row = client.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as
    | { n?: unknown }
    | undefined
  const count = Number(row?.n)
  return Number.isFinite(count) ? count : 0
}
