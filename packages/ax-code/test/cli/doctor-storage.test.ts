import { describe, expect, test } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { getDoctorDatabaseCheck, getDoctorDatabaseIntegrityCheck } from "../../src/cli/cmd/doctor-storage"
import { describeDurableStoragePolicy, DurableStoragePolicy } from "../../src/storage/policy"
import { takePreMigrationBackup } from "../../src/storage/backup"
import { tmpdir } from "../fixture/fixture"

describe("getDoctorDatabaseCheck", () => {
  test("reports the active bundled database path", async () => {
    const check = await getDoctorDatabaseCheck({
      databasePath: "/tmp/ax-code/ax-code.db",
      exists: async (target) => target === "/tmp/ax-code/ax-code.db",
    })

    expect(check).toEqual({
      name: "Data directory",
      status: "ok",
      detail: `/tmp/ax-code/ax-code.db (bundled state); ${describeDurableStoragePolicy()}`,
    })
  })

  test("warns when source and bundled databases both exist", async () => {
    const check = await getDoctorDatabaseCheck({
      databasePath: "/tmp/ax-code/ax-code.db",
      exists: async (target) => target === "/tmp/ax-code/ax-code.db" || target === "/tmp/ax-code/ax-code-local.db",
    })

    expect(check.status).toBe("warn")
    expect(check.detail).toContain("/tmp/ax-code/ax-code.db (bundled state)")
    expect(check.detail).toContain("source/dev state also exists at /tmp/ax-code/ax-code-local.db")
    expect(check.detail).toContain("do not share session state")
  })

  test("marks the source database as not created yet when absent", async () => {
    const check = await getDoctorDatabaseCheck({
      databasePath: "/tmp/ax-code/ax-code-local.db",
      exists: async () => false,
    })

    expect(check).toEqual({
      name: "Data directory",
      status: "ok",
      detail: `/tmp/ax-code/ax-code-local.db (source/dev state, not created yet); ${describeDurableStoragePolicy()}`,
    })
  })

  test("warns when SQLite sidecars exist without the main database", async () => {
    const check = await getDoctorDatabaseCheck({
      databasePath: "/tmp/ax-code/ax-code.db",
      inspect: async (target) => ({
        exists: target.endsWith("-wal") || target.endsWith("-shm"),
        size: target.endsWith("-wal") ? 4096 : target.endsWith("-shm") ? 32768 : undefined,
      }),
    })

    expect(check.status).toBe("warn")
    expect(check.detail).toContain("not created yet")
    expect(check.detail).toContain("SQLite sidecar exists without the main database")
    expect(check.detail).toContain("WAL 4 KiB")
    expect(check.detail).toContain("SHM 32 KiB")
  })

  test("warns when the active database is unusually large", async () => {
    const check = await getDoctorDatabaseCheck({
      databasePath: "/tmp/ax-code/ax-code.db",
      inspect: async (target) => ({
        exists: target === "/tmp/ax-code/ax-code.db",
        size: 256 * 1024 * 1024,
      }),
    })

    expect(check.status).toBe("warn")
    expect(check.detail).toContain("size 256 MiB")
    expect(check.detail).toContain("ax-code db vacuum")
  })

  test("warns when the active WAL is unusually large", async () => {
    const largeWalBytes = DurableStoragePolicy.journalSizeLimitBytes
    const check = await getDoctorDatabaseCheck({
      databasePath: "/tmp/ax-code/ax-code.db",
      inspect: async (target) => ({
        exists: target === "/tmp/ax-code/ax-code.db" || target.endsWith("-wal"),
        size: target.endsWith("-wal") ? largeWalBytes : 8192,
      }),
    })

    expect(check.status).toBe("warn")
    expect(check.detail).toContain("large WAL file: 64 MiB (policy limit 64 MiB)")
  })

  test("promotes rounded storage sizes instead of emitting 1024-unit values", async () => {
    const check = await getDoctorDatabaseCheck({
      databasePath: "/tmp/ax-code/ax-code.db",
      inspect: async (target) => ({
        exists: target === "/tmp/ax-code/ax-code.db" || target.endsWith("-wal") || target.endsWith("-shm"),
        size: target.endsWith("-wal") ? 1024 * 1024 - 1 : target.endsWith("-shm") ? 1024 * 1024 * 1024 - 1 : 8192,
      }),
    })

    expect(check.detail).toContain("WAL 1 MiB")
    expect(check.detail).toContain("SHM 1 GiB")
    expect(check.detail).not.toContain("1024 KiB")
    expect(check.detail).not.toContain("1024 MiB")
  })

  test("fails when database file inspection returns an access error", async () => {
    const check = await getDoctorDatabaseCheck({
      databasePath: "/tmp/ax-code/ax-code.db",
      inspect: async (target) => ({
        exists: false,
        error: target.endsWith("-wal") ? undefined : "permission denied",
      }),
    })

    expect(check.status).toBe("fail")
    expect(check.detail).toContain("cannot inspect database files")
    expect(check.detail).toContain("ax-code.db: permission denied")
  })

  test("warns and reports the rollback journal on a network filesystem", async () => {
    const check = await getDoctorDatabaseCheck({
      databasePath: "/mnt/nfs/ax-code/ax-code.db",
      exists: async (target) => target === "/mnt/nfs/ax-code/ax-code.db",
      env: {},
      isNetworkFilesystem: () => true,
    })

    expect(check.status).toBe("warn")
    expect(check.detail).toContain("data directory is on a network filesystem")
    expect(check.detail).toContain("journal DELETE")
    expect(check.detail).toContain("WAL is unsafe over network mounts")
  })

  test("reports the AX_CODE_SQLITE_JOURNAL override", async () => {
    const check = await getDoctorDatabaseCheck({
      databasePath: "/tmp/ax-code/ax-code.db",
      exists: async () => false,
      env: { AX_CODE_SQLITE_JOURNAL: "truncate" },
      isNetworkFilesystem: () => false,
    })

    expect(check.status).toBe("ok")
    expect(check.detail).toContain("journal TRUNCATE")
    expect(check.detail).toContain("AX_CODE_SQLITE_JOURNAL override")
  })

  test("keeps WAL and stays ok when network detection fails", async () => {
    const check = await getDoctorDatabaseCheck({
      databasePath: "/tmp/ax-code/ax-code.db",
      exists: async () => false,
      isNetworkFilesystem: () => {
        throw new Error("EPERM")
      },
    })

    expect(check.status).toBe("ok")
    expect(check.detail).toContain("journal WAL")
    expect(check.detail).not.toContain("network filesystem")
  })
})

function createHealthyDatabase(file: string, rows = 500) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, payload TEXT)")
  db.exec("BEGIN")
  const insert = db.prepare("INSERT INTO t (id, payload) VALUES (?, ?)")
  for (let i = 0; i < rows; i++) insert.run(i, "x".repeat(100))
  db.exec("COMMIT")
  db.close()
  return file
}

describe("getDoctorDatabaseIntegrityCheck", () => {
  test("reports quick_check ok for a healthy database with no backups yet", async () => {
    await using tmp = await tmpdir()
    const file = createHealthyDatabase(path.join(tmp.path, "ax-code.db"))

    const check = await getDoctorDatabaseIntegrityCheck({ databasePath: file })

    expect(check).toMatchObject({ name: "Database integrity", status: "ok" })
    expect(check.detail).toContain("PRAGMA quick_check ok")
    expect(check.detail).toContain("no pre-migration backups")
  })

  test("fails with the corruption wording for a not-a-database file", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "ax-code.db")
    fs.mkdirSync(tmp.path, { recursive: true })
    fs.writeFileSync(file, "this is definitely not a sqlite database\n")

    const check = await getDoctorDatabaseIntegrityCheck({ databasePath: file })

    expect(check.status).toBe("fail")
    expect(check.detail).toContain("quick_check failed")
    expect(check.detail).toContain("file is not a database")
    expect(check.detail).toContain("left untouched")
  })

  test("fails for a damaged (truncated) database", async () => {
    await using tmp = await tmpdir()
    const file = createHealthyDatabase(path.join(tmp.path, "ax-code.db"))
    fs.truncateSync(file, Math.max(1, Math.floor(fs.statSync(file).size / 3)))

    const check = await getDoctorDatabaseIntegrityCheck({ databasePath: file })

    expect(check.status).toBe("fail")
    expect(check.detail).toContain("database disk image is malformed")
  })

  test("skips quick_check with a note over the size cap", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "ax-code.db")
    fs.mkdirSync(tmp.path, { recursive: true })
    fs.writeFileSync(file, "SQLite format 3\0")
    // Sparse file: reports a size over the cap without occupying the disk.
    fs.truncateSync(file, DurableStoragePolicy.preMigrationBackupMaxSourceBytes + 1)

    const check = await getDoctorDatabaseIntegrityCheck({ databasePath: file })

    expect(check.status).toBe("warn")
    expect(check.detail).toContain("quick_check skipped")
    expect(check.detail).toContain("exceeds cap")
  })

  test("skips with a note when the database is not created yet", async () => {
    const check = await getDoctorDatabaseIntegrityCheck({
      databasePath: "/tmp/ax-code/ax-code.db",
      exists: async () => false,
    })

    expect(check.status).toBe("ok")
    expect(check.detail).toContain("quick_check skipped (database not created yet)")
  })

  test("lists existing backups with age and size", async () => {
    await using tmp = await tmpdir()
    const file = createHealthyDatabase(path.join(tmp.path, "ax-code.db"))
    const result = takePreMigrationBackup({
      dbPath: file,
      fileBytes: fs.statSync(file).size,
      migrationPending: true,
      existingSchema: true,
      vacuumInto: (target) => {
        const db = new DatabaseSync(file)
        try {
          db.prepare("VACUUM INTO ?").run(target)
        } finally {
          db.close()
        }
      },
    })
    expect(result.took).toBe(true)
    const backedUpAt = fs.statSync(result.backupPath!).mtimeMs

    const check = await getDoctorDatabaseIntegrityCheck({ databasePath: file, now: () => backedUpAt + 5 * 60_000 })

    expect(check.detail).toContain("1 backup(s)")
    expect(check.detail).toContain(path.basename(result.backupPath!))
    expect(check.detail).toContain("5m old")
    expect(check.detail).toMatch(/old, \d+ (?:B|KiB|MiB|GiB|TiB)\)$/)
  })
})
