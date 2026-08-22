import { describe, expect, test } from "vitest"
import { spawnSync } from "node:child_process"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { MigrationLock } from "../../src/storage/migrate-lock"

// Regression coverage for the concurrent-boot migration race: two processes
// opening the same database after an upgrade must not both run the same
// non-idempotent DDL (the v7.7.7 `scheduled_task_run` "table already exists"
// boot crash). These tests cover the lock's acquire / release / steal
// semantics; the serialization itself follows from the lock being held
// across dialect.migrate in Database.Client.
describe("MigrationLock", () => {
  test("acquire creates the lockfile and release removes it", async () => {
    await using tmp = await tmpdir()
    const db = path.join(tmp.path, "ax-code.db")
    const release = MigrationLock.acquire(db)
    expect(fs.existsSync(db + ".migrate.lock")).toBe(true)
    release()
    expect(fs.existsSync(db + ".migrate.lock")).toBe(false)
  })

  test("steals a lock older than the stale threshold", async () => {
    await using tmp = await tmpdir()
    const db = path.join(tmp.path, "ax-code.db")
    fs.writeFileSync(
      db + ".migrate.lock",
      JSON.stringify({ pid: process.pid, startedAt: Date.now() - 60 * 60 * 1000, host: "test-host" }),
    )
    const start = Date.now()
    const release = MigrationLock.acquire(db)
    // Stolen immediately instead of spinning until the acquire timeout.
    expect(Date.now() - start).toBeLessThan(10_000)
    release()
  })

  test("steals a lock whose holder process is dead", async () => {
    await using tmp = await tmpdir()
    const db = path.join(tmp.path, "ax-code.db")
    const child = spawnSync(process.execPath, ["-e", "process.exit(0)"])
    expect(child.status).toBe(0)
    fs.writeFileSync(
      db + ".migrate.lock",
      JSON.stringify({ pid: child.pid, startedAt: Date.now(), host: os.hostname() }),
    )
    const start = Date.now()
    const release = MigrationLock.acquire(db)
    expect(Date.now() - start).toBeLessThan(10_000)
    release()
  })

  test("a corrupt lockfile is treated as stealable", async () => {
    await using tmp = await tmpdir()
    const db = path.join(tmp.path, "ax-code.db")
    fs.writeFileSync(db + ".migrate.lock", "not json")
    const release = MigrationLock.acquire(db)
    expect(fs.existsSync(db + ".migrate.lock")).toBe(true)
    release()
  })
})
