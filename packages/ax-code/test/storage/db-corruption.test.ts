import { describe, expect, test, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { Database } from "../../src/storage/db"
import { CorruptDatabaseError } from "../../src/storage/corrupt"

// Real error shapes produced by node:sqlite (probed against the actual
// driver): `code` is always "ERR_SQLITE_ERROR", the SQLite primary result
// code rides on `errcode`, and the driver message distinguishes corruption
// (SQLITE_CORRUPT=11) from not-a-database (SQLITE_NOTADB=26).
const notadb = () => Object.assign(new Error("file is not a database"), { errcode: 26, code: "ERR_SQLITE_ERROR" })
const malformed = () =>
  Object.assign(new Error("database disk image is malformed"), { errcode: 11, code: "ERR_SQLITE_ERROR" })

describe("Database.isCorruptError", () => {
  test("matches the node:sqlite corruption shapes by errcode", () => {
    expect(Database.isCorruptError(notadb())).toBe(true)
    expect(Database.isCorruptError(malformed())).toBe(true)
    // Extended result codes keep the primary code in the low byte
    // (e.g. 523 = SQLITE_CORRUPT_VTAB).
    expect(
      Database.isCorruptError(Object.assign(new Error("database disk image is malformed"), { errcode: 523 })),
    ).toBe(true)
  })

  test("matches wrapped and message/code-only variants", () => {
    expect(Database.isCorruptError(new Error("Failed query", { cause: notadb() }))).toBe(true)
    expect(Database.isCorruptError(new Error("Failed query", { cause: malformed() }))).toBe(true)
    expect(Database.isCorruptError({ code: "SQLITE_NOTADB" })).toBe(true)
    expect(Database.isCorruptError({ code: "SQLITE_CORRUPT_SEQUENCE" })).toBe(true)
    expect(Database.isCorruptError(new Error("file is not a database"))).toBe(true)
    expect(Database.isCorruptError(new Error("database disk image is malformed"))).toBe(true)
  })

  test("terminates on cyclic causes and rejects non-corrupt errors", () => {
    const cyclic = new Error("Failed query")
    cyclic.cause = cyclic
    expect(Database.isCorruptError(cyclic)).toBe(false)
    expect(
      Database.isCorruptError(Object.assign(new Error("attempt to write a readonly database"), { errcode: 8 })),
    ).toBe(false)
    expect(Database.isCorruptError(Object.assign(new Error("disk I/O error"), { errcode: 10 }))).toBe(false)
    expect(Database.isCorruptError(undefined)).toBe(false)
    expect(Database.isCorruptError("file is not a database")).toBe(false)
  })

  test("corruption is never classified as busy contention and vice versa", () => {
    const busy = Object.assign(new Error("database is locked"), { errcode: 5 })
    expect(Database.isCorruptError(busy)).toBe(false)
    expect(Database.isBusyError(notadb())).toBe(false)
    expect(Database.isBusyError(malformed())).toBe(false)
  })
})

// The integration tests below drive the real open/migrate path against the
// per-file isolated data dir, re-importing the module for a fresh Client.
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

describe("corrupt main database handling", () => {
  test("raises CorruptDatabaseError for a not-a-database file, leaves it untouched, and fails fast afterwards", async () => {
    removeDatabaseFiles()
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(Database.Path, "this is definitely not a sqlite database\n")
    const before = fs.readFileSync(Database.Path)

    const { Database: Fresh } = await freshDatabase()
    let caught: unknown
    try {
      Fresh.use(() => "unreachable")
    } catch (error) {
      caught = error
    }

    expect(CorruptDatabaseError.isInstance(caught)).toBe(true)
    const error = caught as InstanceType<typeof CorruptDatabaseError>
    expect(error.data.file).toBe(Database.Path)
    expect(error.data.backups).toBe(path.join(dataDir, "backups"))
    expect(error.message).toContain(Database.Path)
    expect(error.message).toContain(path.join(dataDir, "backups"))
    expect(error.message).toContain("ax-code doctor")
    // Never renamed, overwritten, or deleted.
    expect(fs.readFileSync(Database.Path).equals(before)).toBe(true)

    // The handle is poisoned: a later access fails fast without touching the file.
    let second: unknown
    try {
      Fresh.use(() => "unreachable")
    } catch (retry) {
      second = retry
    }
    expect(CorruptDatabaseError.isInstance(second)).toBe(true)
    expect(fs.readFileSync(Database.Path).equals(before)).toBe(true)
  })

  test("raises CorruptDatabaseError for a damaged (truncated) migrated database", async () => {
    removeDatabaseFiles()
    {
      const { Database: First } = await freshDatabase()
      First.use(() => "open and migrate")
      await First.close()
    }
    const size = fs.statSync(Database.Path).size
    expect(size).toBeGreaterThan(0)
    fs.truncateSync(Database.Path, Math.max(1, Math.floor(size / 3)))
    const before = fs.readFileSync(Database.Path)

    const { Database: Fresh } = await freshDatabase()
    let caught: unknown
    try {
      Fresh.use(() => "unreachable")
    } catch (error) {
      caught = error
    }
    // Name-based check: vi.resetModules gives the fresh module its own class
    // object, so cross-graph instanceof would fail spuriously.
    expect(CorruptDatabaseError.isInstance(caught)).toBe(true)
    expect((caught as InstanceType<typeof CorruptDatabaseError>).data.file).toBe(Database.Path)
    expect(fs.readFileSync(Database.Path).equals(before)).toBe(true)
  })

  test("poisons a live handle when corruption appears during use and closes without the checkpoint", async () => {
    removeDatabaseFiles()
    const { Database: Live } = await freshDatabase()
    Live.use(() => "healthy open and migrate")

    // Grow the database well past the first pages, keep the page cache tiny
    // so a later scan must re-read pages from disk, and checkpoint everything
    // into the main file so the truncation below is deterministic.
    Live.use((db) => {
      db.run("CREATE TABLE poison_probe (id INTEGER PRIMARY KEY, payload TEXT)")
      db.run("PRAGMA cache_size = -64")
      db.run(
        "WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < 20000) " +
          "INSERT INTO poison_probe (id, payload) SELECT i, 'x' FROM seq",
      )
    })
    Live.use((db) => db.run("PRAGMA wal_checkpoint(TRUNCATE)"))
    const size = fs.statSync(Database.Path).size
    expect(size).toBeGreaterThan(8192)
    fs.truncateSync(Database.Path, Math.floor(size / 2))

    // The read hits pages beyond EOF and fails with a structural error.
    expect(() => Live.use((db) => db.run("SELECT count(*) FROM poison_probe"))).toThrow()

    // The handle is poisoned: the next entry fails fast with the actionable
    // error instead of reusing the poisoned handle...
    let caught: unknown
    try {
      Live.use(() => {})
    } catch (error) {
      caught = error
    }
    expect(CorruptDatabaseError.isInstance(caught)).toBe(true)
    // ...and shutdown skips the WAL checkpoint on the damaged file.
    await Live.close()
  })
})
