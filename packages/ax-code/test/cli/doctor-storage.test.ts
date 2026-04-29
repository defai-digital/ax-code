import { describe, expect, test } from "bun:test"
import { getDoctorDatabaseCheck } from "../../src/cli/cmd/doctor-storage"
import { DurableStoragePolicy } from "../../src/storage/policy"

describe("getDoctorDatabaseCheck", () => {
  test("reports the active bundled database path", async () => {
    const check = await getDoctorDatabaseCheck({
      databasePath: "/tmp/ax-code/ax-code.db",
      exists: async (target) => target === "/tmp/ax-code/ax-code.db",
    })

    expect(check).toEqual({
      name: "Data directory",
      status: "ok",
      detail: "/tmp/ax-code/ax-code.db (bundled state)",
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
      detail: "/tmp/ax-code/ax-code-local.db (source/dev state, not created yet)",
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
    expect(check.detail).toContain("large WAL file: 64 MiB")
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
})
