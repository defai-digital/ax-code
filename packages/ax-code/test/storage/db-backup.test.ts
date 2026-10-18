import { describe, expect, test, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "../fixture/fixture"
import { Database } from "../../src/storage/db"
import {
  backupsDirectoryFor,
  isBackupFileFor,
  journalMigrationPending,
  listDatabaseBackups,
  readAppliedJournalVersion,
  takePreMigrationBackup,
} from "../../src/storage/backup"
import { DurableStoragePolicy } from "../../src/storage/policy"

function createPopulatedDb(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, payload TEXT)")
  db.exec("INSERT INTO session (id, payload) VALUES ('ses_1', 'important-history')")
  db.close()
  return file
}

function vacuumIntoWith(file: string) {
  return (target: string) => {
    const db = new DatabaseSync(file)
    try {
      db.prepare("VACUUM INTO ?").run(target)
    } finally {
      db.close()
    }
  }
}

describe("takePreMigrationBackup", () => {
  test("takes a consistent VACUUM INTO backup and rotates to the newest two", async () => {
    await using tmp = await tmpdir()
    const file = createPopulatedDb(path.join(tmp.path, "ax-code.db"))
    const start = Date.UTC(2026, 9, 16, 9, 30, 0)
    const tags = ["20261016T093000000Z", "20261016T093100000Z", "20261016T093200000Z"]
    for (const [index, at] of [start, start + 60_000, start + 120_000].entries()) {
      const result = takePreMigrationBackup({
        dbPath: file,
        fileBytes: fs.statSync(file).size,
        migrationPending: true,
        existingSchema: true,
        vacuumInto: vacuumIntoWith(file),
        now: () => at,
      })
      expect(result.took).toBe(true)
      expect(result.reason).toBeUndefined()
      expect(result.backupPath!.endsWith(`ax-code.db.${tags[index]}.bak`)).toBe(true)
    }

    const backups = listDatabaseBackups({ dbPath: file })
    expect(backups).toHaveLength(DurableStoragePolicy.preMigrationBackupsKept)
    const names = backups.map((backup) => backup.file)
    // Newest kept first; the oldest of the three was pruned.
    expect(names).toEqual(["ax-code.db.20261016T093200000Z.bak", "ax-code.db.20261016T093100000Z.bak"])
    expect(fs.readdirSync(backupsDirectoryFor(file)).filter((name) => name.endsWith(".tmp"))).toEqual([])

    // The backup is the consistent pre-migration state.
    const ro = new DatabaseSync(backups[0].path, { readOnly: true })
    expect(ro.prepare("SELECT payload FROM session WHERE id = 'ses_1'").all()).toEqual([
      { payload: "important-history" },
    ])
    ro.close()
  })

  test("skips when no migration is pending, the database is empty, or over the size cap", async () => {
    await using tmp = await tmpdir()
    const file = createPopulatedDb(path.join(tmp.path, "ax-code.db"))

    const notPending = takePreMigrationBackup({
      dbPath: file,
      fileBytes: 4096,
      migrationPending: false,
      existingSchema: true,
      vacuumInto: vacuumIntoWith(file),
    })
    expect(notPending).toEqual({ took: false, reason: "not-pending" })
    expect(fs.existsSync(backupsDirectoryFor(file))).toBe(false)

    // A brand-new database is skipped even though its file is non-empty: the
    // startup pragmas materialize a header page before this decision runs.
    const empty = takePreMigrationBackup({
      dbPath: file,
      fileBytes: 4096,
      migrationPending: true,
      existingSchema: false,
      vacuumInto: vacuumIntoWith(file),
    })
    expect(empty).toEqual({ took: false, reason: "empty" })
    expect(fs.existsSync(backupsDirectoryFor(file))).toBe(false)

    const oversized = takePreMigrationBackup({
      dbPath: file,
      fileBytes: DurableStoragePolicy.preMigrationBackupMaxSourceBytes + 1,
      migrationPending: true,
      existingSchema: true,
      vacuumInto: vacuumIntoWith(file),
    })
    expect(oversized).toEqual({ took: false, reason: "size-cap" })
    expect(fs.existsSync(backupsDirectoryFor(file))).toBe(false)
  })

  test("never throws when the backup itself fails", async () => {
    await using tmp = await tmpdir()
    const file = createPopulatedDb(path.join(tmp.path, "ax-code.db"))
    const result = takePreMigrationBackup({
      dbPath: file,
      fileBytes: fs.statSync(file).size,
      migrationPending: true,
      existingSchema: true,
      vacuumInto: () => {
        throw Object.assign(new Error("disk I/O error"), { code: "EIO" })
      },
    })
    expect(result.took).toBe(false)
    expect(result.reason).toBe("failed")
    expect(result.error).toContain("disk I/O error")
    // No partial temp or backup file is left behind.
    expect(fs.existsSync(backupsDirectoryFor(file)) ? fs.readdirSync(backupsDirectoryFor(file)) : []).toEqual([])
  })
})

describe("journal version helpers", () => {
  test("reads the applied drizzle journal version and treats a missing table as fresh", async () => {
    await using tmp = await tmpdir()
    const db = new DatabaseSync(path.join(tmp.path, "journal.db"))
    db.exec("CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at NUMERIC)")
    db.exec("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('a', 100)")
    db.exec("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('b', 500)")
    expect(readAppliedJournalVersion(db)).toBe(500)

    const fresh = new DatabaseSync(path.join(tmp.path, "fresh.db"))
    fresh.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)")
    expect(readAppliedJournalVersion(fresh)).toBe(-1)
  })

  test("a migration is pending only when the journal is ahead", () => {
    expect(journalMigrationPending(-1, 100)).toBe(true)
    expect(journalMigrationPending(100, 400)).toBe(true)
    expect(journalMigrationPending(400, 400)).toBe(false)
    expect(journalMigrationPending(500, 400)).toBe(false)
  })

  test("backup filenames are scoped per database file", () => {
    expect(isBackupFileFor("/data/ax-code.db", "ax-code.db.20261016T093000000Z.bak")).toBe(true)
    // A different database in the same backups directory must not be matched
    // (ax-code.db vs the source/dev ax-code-local.db).
    expect(isBackupFileFor("/data/ax-code.db", "ax-code-local.db.20261016T093000000Z.bak")).toBe(false)
    expect(isBackupFileFor("/data/ax-code.db", "ax-code.db.20261016T093000000Z.tmp")).toBe(false)
    // A hand-placed copy without the exact tag shape must not enter the
    // rotation list — pruneBackups would silently delete it.
    expect(isBackupFileFor("/data/ax-code.db", "ax-code.db.bak")).toBe(false)
    expect(isBackupFileFor("/data/ax-code.db", "ax-code.db.keep.bak")).toBe(false)
    expect(isBackupFileFor("/data/ax-code.db", "ax-code.db.20261016.bak")).toBe(false)
  })

  test("a hand-placed backup survives the pre-migration rotation", async () => {
    await using tmp = await tmpdir()
    const file = createPopulatedDb(path.join(tmp.path, "ax-code.db"))
    const manual = path.join(backupsDirectoryFor(file), "ax-code.db.bak")
    fs.mkdirSync(path.dirname(manual), { recursive: true })
    fs.copyFileSync(file, manual)

    const start = Date.UTC(2026, 9, 16, 9, 30, 0)
    for (const at of [start, start + 60_000, start + 120_000]) {
      takePreMigrationBackup({
        dbPath: file,
        fileBytes: fs.statSync(file).size,
        migrationPending: true,
        existingSchema: true,
        vacuumInto: vacuumIntoWith(file),
        now: () => at,
      })
    }

    expect(fs.existsSync(manual)).toBe(true)
    expect(listDatabaseBackups({ dbPath: file }).map((backup) => backup.file)).toEqual([
      "ax-code.db.20261016T093200000Z.bak",
      "ax-code.db.20261016T093100000Z.bak",
    ])
  })

  test("same-millisecond backups use distinct temp paths", async () => {
    await using tmp = await tmpdir()
    const file = createPopulatedDb(path.join(tmp.path, "ax-code.db"))
    const targets: string[] = []
    const at = Date.UTC(2026, 9, 16, 9, 30, 0)
    for (let i = 0; i < 2; i++) {
      const result = takePreMigrationBackup({
        dbPath: file,
        fileBytes: fs.statSync(file).size,
        migrationPending: true,
        existingSchema: true,
        vacuumInto: (target) => {
          targets.push(target)
          fs.writeFileSync(target, `snapshot-${i}`)
        },
        now: () => at,
      })
      expect(result.took).toBe(true)
    }
    expect(targets).toHaveLength(2)
    expect(new Set(targets).size).toBe(2)
  })
})

// Integration: the real open/migrate path against the per-file isolated data
// dir, re-importing the module for a fresh Client between scenarios.
const dataDir = path.dirname(Database.Path)

function removeDatabaseFiles() {
  for (const suffix of ["", "-wal", "-shm", ".migrate.lock", ".migrate.guard"]) {
    fs.rmSync(Database.Path + suffix, { force: true })
  }
  fs.rmSync(path.join(dataDir, "backups"), { recursive: true, force: true })
}

async function freshDatabase() {
  vi.resetModules()
  return await import("../../src/storage/db")
}

describe("pre-migration backup wiring", () => {
  test("a fresh database migrates without a backup, and a second open takes none either", async () => {
    removeDatabaseFiles()
    {
      const { Database: Fresh } = await freshDatabase()
      Fresh.use(() => "first open migrates the empty database")
      await Fresh.close()
    }
    expect(listDatabaseBackups({ dbPath: Database.Path })).toHaveLength(0)

    {
      const { Database: Again } = await freshDatabase()
      Again.use(() => "schema already current")
      await Again.close()
    }
    expect(listDatabaseBackups({ dbPath: Database.Path })).toHaveLength(0)
  })

  test("backs up an existing pre-journal database before migrating it", async () => {
    removeDatabaseFiles()
    fs.mkdirSync(dataDir, { recursive: true })
    // A database from an older layout: real data, no __drizzle_migrations.
    const legacy = new DatabaseSync(Database.Path)
    legacy.exec("CREATE TABLE legacy_session (id TEXT PRIMARY KEY)")
    legacy.exec("INSERT INTO legacy_session (id) VALUES ('legacy-1')")
    legacy.close()

    const { Database: Fresh } = await freshDatabase()
    Fresh.use(() => "backup, then migrate")

    const backups = listDatabaseBackups({ dbPath: Database.Path })
    expect(backups).toHaveLength(1)
    // The backup is the pre-migration state: data intact, journal table absent.
    const ro = new DatabaseSync(backups[0].path, { readOnly: true })
    expect(ro.prepare("SELECT id FROM legacy_session").all()).toEqual([{ id: "legacy-1" }])
    expect(
      ro.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").all(),
    ).toEqual([])
    ro.close()

    // The live database was migrated after the backup.
    const live = new DatabaseSync(Database.Path, { readOnly: true })
    const applied = live.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }
    expect(applied.n).toBeGreaterThan(0)
    live.close()
    await Fresh.close()
  })

  test("a failed backup does not block startup — migrations still run", async () => {
    removeDatabaseFiles()
    fs.mkdirSync(dataDir, { recursive: true })
    const legacy = new DatabaseSync(Database.Path)
    legacy.exec("CREATE TABLE legacy_session (id TEXT PRIMARY KEY)")
    legacy.exec("INSERT INTO legacy_session (id) VALUES ('legacy-1')")
    legacy.close()

    // The backups directory is read-only, so VACUUM INTO cannot create the
    // temp file. Startup must continue anyway.
    const backupsDir = path.join(dataDir, "backups")
    fs.mkdirSync(backupsDir, { recursive: true })
    fs.chmodSync(backupsDir, 0o500)
    try {
      const { Database: Fresh } = await freshDatabase()
      expect(Fresh.use(() => "migrated anyway")).toBe("migrated anyway")
      const live = new DatabaseSync(Database.Path, { readOnly: true })
      const applied = live.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }
      expect(applied.n).toBeGreaterThan(0)
      live.close()
      await Fresh.close()
    } finally {
      fs.chmodSync(backupsDir, 0o700)
    }
    expect(listDatabaseBackups({ dbPath: Database.Path })).toHaveLength(0)
  })
})
