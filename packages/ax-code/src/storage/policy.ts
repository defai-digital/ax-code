import { isNetworkFilesystem } from "./network-fs"

export type SqliteJournalMode = "WAL" | "DELETE" | "TRUNCATE"

export const DurableStoragePolicy = {
  // Keep SQLite's built-in WAL as the batching/durability boundary instead
  // of introducing an app-level in-memory database with background sync.
  // This preserves SQLite's cross-process locking and crash-recovery
  // semantics while still reducing immediate fsync pressure.
  busyTimeoutMs: 15_000,
  journalMode: "WAL",
  synchronous: "NORMAL",
  cacheSizeKiB: 64 * 1024,
  tempStore: "MEMORY",
  walAutoCheckpointPages: 1_000,
  journalSizeLimitBytes: 64 * 1024 * 1024,
  shutdownCheckpointMode: "TRUNCATE",
  // Pre-migration safety net (storage/backup.ts): before journal migrations
  // touch an existing database whose schema is behind, a VACUUM INTO backup
  // is taken. Databases larger than this cap are skipped with a warning, and
  // only the newest `preMigrationBackupsKept` backups are kept per database.
  preMigrationBackupMaxSourceBytes: 2 * 1024 * 1024 * 1024,
  preMigrationBackupsKept: 2,
} as const

// ADR-210: WAL's shared-memory -shm sidecar is unsafe over NFS/SMB, so a
// database on a network filesystem uses a rollback journal instead.
// AX_CODE_SQLITE_JOURNAL (wal|delete|truncate) overrides the detection.
// Detection failure keeps WAL (the DurableStoragePolicy default).
export function resolveSqliteJournalMode(
  input: {
    path?: string
    env?: Record<string, string | undefined>
    isNetworkFilesystem?: (target: string) => boolean
  } = {},
): SqliteJournalMode {
  const override = parseSqliteJournalOverride((input.env ?? process.env).AX_CODE_SQLITE_JOURNAL)
  if (override) return override
  if (input.path) {
    const probe = input.isNetworkFilesystem ?? isNetworkFilesystem
    try {
      if (probe(input.path)) return "DELETE"
    } catch {
      // Detection failure keeps WAL.
    }
  }
  return DurableStoragePolicy.journalMode
}

export function parseSqliteJournalOverride(value: string | undefined): SqliteJournalMode | undefined {
  switch (value?.trim().toLowerCase()) {
    case "wal":
      return "WAL"
    case "delete":
      return "DELETE"
    case "truncate":
      return "TRUNCATE"
    default:
      return undefined
  }
}

/**
 * NORMAL is corruption-safe only in WAL mode. In the rollback-journal modes
 * (network-filesystem fallback or AX_CODE_SQLITE_JOURNAL override), a journal
 * page that power loss catches unsynced can corrupt the database, not just
 * roll back the last transaction, so those modes run FULL.
 */
export function resolveSqliteSynchronous(journalMode: SqliteJournalMode): "NORMAL" | "FULL" {
  return journalMode === "WAL" ? DurableStoragePolicy.synchronous : "FULL"
}

export function describeDurableStoragePolicy(input?: { journalMode?: SqliteJournalMode }) {
  const journalMode = input?.journalMode ?? DurableStoragePolicy.journalMode
  return [
    `SQLite policy: journal ${journalMode}`,
    `synchronous ${resolveSqliteSynchronous(journalMode)}`,
    `busy timeout ${DurableStoragePolicy.busyTimeoutMs}ms`,
    `WAL autocheckpoint ${DurableStoragePolicy.walAutoCheckpointPages} pages`,
    `journal limit ${formatStorageBytes(DurableStoragePolicy.journalSizeLimitBytes)}`,
  ].join(", ")
}

/** Format storage sizes without rounded values overflowing into the next unit. */
export function formatStorageBytes(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"] as const
  let value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0
  let unit = 0
  while (unit < units.length - 1 && Math.round(value) >= 1024) {
    value /= 1024
    unit += 1
  }
  return `${Math.round(value)} ${units[unit]}`
}
