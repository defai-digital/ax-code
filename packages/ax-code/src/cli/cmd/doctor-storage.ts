import path from "path"
import { stat } from "node:fs/promises"
import { describeDurableStoragePolicy, DurableStoragePolicy, formatStorageBytes } from "../../storage/policy"
import { isCorruptError } from "../../storage/corrupt"
import { listDatabaseBackups } from "../../storage/backup"
import { toErrorMessage } from "@/util/error-message"

export type DoctorCheck = {
  name: string
  status: "ok" | "warn" | "fail"
  detail: string
}

type DatabaseFileInfo = {
  exists: boolean
  size?: number
  error?: string
}

const LARGE_WAL_BYTES = DurableStoragePolicy.journalSizeLimitBytes
const LARGE_DATABASE_BYTES = 256 * 1024 * 1024

export async function getDoctorDatabaseCheck(input: {
  databasePath: string
  exists?: (target: string) => Promise<boolean>
  inspect?: (target: string) => Promise<DatabaseFileInfo>
}): Promise<DoctorCheck> {
  const inspect = input.inspect ?? (input.exists ? inspectWithExists(input.exists) : inspectWithStat)
  const databasePath = input.databasePath
  const databaseName = path.basename(databasePath)
  const dataDir = path.dirname(databasePath)
  const bundledPath = path.join(dataDir, "ax-code.db")
  const localPath = path.join(dataDir, "ax-code-local.db")
  const current = await inspect(databasePath)
  const wal = await inspect(`${databasePath}-wal`)
  const shm = await inspect(`${databasePath}-shm`)

  let status: DoctorCheck["status"] = "ok"
  const markWarn = () => {
    if (status !== "fail") status = "warn"
  }
  const details = [
    `${databasePath} (${databaseModeLabel(databaseName)}${current.exists ? "" : ", not created yet"})`,
    describeDurableStoragePolicy(),
  ]

  const readErrors = [
    current.error ? `${databaseName}: ${current.error}` : undefined,
    wal.error ? `${databaseName}-wal: ${wal.error}` : undefined,
    shm.error ? `${databaseName}-shm: ${shm.error}` : undefined,
  ].filter(Boolean)

  if (readErrors.length > 0) {
    status = "fail"
    details.push(`cannot inspect database files: ${readErrors.join("; ")}`)
  }

  if (!current.exists && (wal.exists || shm.exists)) {
    markWarn()
    details.push("SQLite sidecar exists without the main database")
  }

  if (wal.exists && (wal.size ?? 0) >= LARGE_WAL_BYTES) {
    markWarn()
    details.push(
      `large WAL file: ${formatStorageBytes(wal.size ?? 0)} (policy limit ${formatStorageBytes(LARGE_WAL_BYTES)})`,
    )
  } else if (wal.exists && wal.size !== undefined) {
    details.push(`WAL ${formatStorageBytes(wal.size)}`)
  }

  if (shm.exists && shm.size !== undefined) {
    details.push(`SHM ${formatStorageBytes(shm.size)}`)
  }

  const alternatePath =
    databaseName === "ax-code.db" ? localPath : databaseName === "ax-code-local.db" ? bundledPath : undefined

  if (current.exists && current.size !== undefined) {
    details.push(`size ${formatStorageBytes(current.size)}`)
    if (current.size >= LARGE_DATABASE_BYTES) {
      markWarn()
      details.push("database is large; run `ax-code session prune` then `ax-code db vacuum` to reclaim space")
    }
  }

  if (alternatePath && (await inspect(alternatePath)).exists) {
    markWarn()
    details.push(
      `${databaseModeLabel(path.basename(alternatePath))} also exists at ${alternatePath}; source/dev and packaged installs do not share session state. Remove the unused file after confirming which install you use, or run \`ax-code db vacuum\` on the active database`,
    )
  }

  return {
    name: "Data directory",
    status,
    detail: details.join("; "),
  }
}

function databaseModeLabel(databaseName: string) {
  if (databaseName === "ax-code.db") return "bundled state"
  if (databaseName === "ax-code-local.db") return "source/dev state"
  return `${databaseName} state`
}

function inspectWithExists(exists: (target: string) => Promise<boolean>) {
  return async (target: string): Promise<DatabaseFileInfo> => ({ exists: await exists(target) })
}

async function inspectWithStat(target: string): Promise<DatabaseFileInfo> {
  try {
    const result = await stat(target)
    return { exists: true, size: result.size }
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return { exists: false }
    return {
      exists: false,
      error: toErrorMessage(error),
    }
  }
}

type QuickCheckOutcome =
  | { kind: "ok" }
  | { kind: "problems"; rows: string[] }
  | { kind: "error"; message: string; corrupt: boolean }

// PRAGMA quick_check on a read-only connection (the fast integrity probe —
// it stops at the first error, unlike integrity_check). A WAL database with
// a lingering -wal and no live writer may refuse a read-only open; the
// fallback open is read-write but quick_check itself performs no writes.
async function runQuickCheck(file: string): Promise<QuickCheckOutcome> {
  const { DatabaseSync } = await import("node:sqlite")
  let db: InstanceType<typeof DatabaseSync>
  try {
    db = new DatabaseSync(file, { open: true, readOnly: true })
  } catch {
    try {
      db = new DatabaseSync(file, { open: true, readOnly: false })
    } catch (error) {
      return { kind: "error", message: toErrorMessage(error), corrupt: isCorruptError(error) }
    }
  }
  try {
    const rows = db.prepare("PRAGMA quick_check").all() as { quick_check?: unknown }[]
    const messages = rows.map((row) => String(row.quick_check ?? ""))
    if (messages.length === 1 && messages[0] === "ok") return { kind: "ok" }
    return { kind: "problems", rows: messages }
  } catch (error) {
    return { kind: "error", message: toErrorMessage(error), corrupt: isCorruptError(error) }
  } finally {
    try {
      db.close()
    } catch {
      // A close failure does not invalidate the quick_check result.
    }
  }
}

const QUICK_CHECK_MAX_PROBLEMS_SHOWN = 5
const BACKUPS_SHOWN = 5

function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/**
 * Storage integrity row for `ax-code doctor` / `ax-code db check`: runs
 * PRAGMA quick_check against the main database on a read-only connection
 * (skipped with a note when the file is absent or over the backup size cap —
 * the quick_check cost guard), and lists the pre-migration backups that exist
 * for it with age and size.
 */
export async function getDoctorDatabaseIntegrityCheck(input: {
  databasePath: string
  exists?: (target: string) => Promise<boolean>
  inspect?: (target: string) => Promise<DatabaseFileInfo>
  now?: () => number
}): Promise<DoctorCheck> {
  const inspect = input.inspect ?? (input.exists ? inspectWithExists(input.exists) : inspectWithStat)
  const now = input.now ?? Date.now
  const databasePath = input.databasePath
  const current = await inspect(databasePath)

  let status: DoctorCheck["status"] = "ok"
  const markWarn = () => {
    if (status !== "fail") status = "warn"
  }
  const details: string[] = []

  if (!current.exists) {
    details.push("PRAGMA quick_check skipped (database not created yet)")
  } else if ((current.size ?? 0) > DurableStoragePolicy.preMigrationBackupMaxSourceBytes) {
    markWarn()
    details.push(
      `PRAGMA quick_check skipped (size ${formatStorageBytes(current.size ?? 0)} exceeds cap ${formatStorageBytes(
        DurableStoragePolicy.preMigrationBackupMaxSourceBytes,
      )})`,
    )
  } else {
    const outcome = await runQuickCheck(databasePath)
    if (outcome.kind === "ok") {
      details.push("PRAGMA quick_check ok")
    } else if (outcome.kind === "problems") {
      status = "fail"
      const shown = outcome.rows.slice(0, QUICK_CHECK_MAX_PROBLEMS_SHOWN)
      const hidden = outcome.rows.length - shown.length
      details.push(
        `quick_check found ${outcome.rows.length} problem(s): ${shown.join(" | ")}${hidden > 0 ? ` (+${hidden} more)` : ""}`,
      )
    } else if (outcome.corrupt) {
      status = "fail"
      details.push(
        `quick_check failed: ${outcome.message}. The file was left untouched — ` +
          `inspect the pre-migration backups below (or run "ax-code db check") before deleting anything`,
      )
    } else {
      markWarn()
      details.push(`could not run quick_check: ${outcome.message}`)
    }
  }

  const backups = listDatabaseBackups({ dbPath: databasePath })
  if (backups.length === 0) {
    details.push("no pre-migration backups (backups are only taken before schema migrations run)")
  } else {
    const shown = backups.slice(0, BACKUPS_SHOWN)
    const hidden = backups.length - shown.length
    const listed = shown
      .map(
        (backup) =>
          `${backup.file} (${formatAge(now() - backup.mtimeMs)} old, ${formatStorageBytes(backup.sizeBytes)})`,
      )
      .join(", ")
    details.push(`${backups.length} backup(s): ${listed}${hidden > 0 ? `, +${hidden} more` : ""}`)
  }

  return {
    name: "Database integrity",
    status,
    detail: details.join("; "),
  }
}
