import { afterEach, describe, expect, test } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { Shard } from "../../src/storage/shard"
import { CorruptDatabaseError } from "../../src/storage/corrupt"
import { listDatabaseBackups } from "../../src/storage/backup"

// ProjectID is a branded string; tests use plain strings through `as any`
// (same convention as shard.test.ts — the shard layer only reads the raw value).
const pid = (id: string) => id as any

afterEach(() => Shard.closeAll())

describe("Shard corruption handling", () => {
  test("raises CorruptDatabaseError for a garbage shard file, leaves it untouched, and fails fast afterwards", () => {
    const id = pid("project-corrupt-garbage")
    const file = Shard.pathFor(id)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "this is definitely not a sqlite database\n")
    const before = fs.readFileSync(file)

    expect(() => Shard.handle(id).use(() => "unreachable")).toThrow(CorruptDatabaseError)
    expect(fs.readFileSync(file).equals(before)).toBe(true)

    // The shard is poisoned: a later access fails fast without touching the file.
    let caught: unknown
    try {
      Shard.handle(id).use(() => "unreachable")
    } catch (error) {
      caught = error
    }
    expect(CorruptDatabaseError.isInstance(caught)).toBe(true)
    const error = caught as InstanceType<typeof CorruptDatabaseError>
    expect(error.data.file).toBe(file)
    expect(error.data.backups).toBe(path.join(path.dirname(file), "backups"))
    expect(error.message).toContain("ax-code doctor")
    expect(fs.readFileSync(file).equals(before)).toBe(true)
    // No handle was cached for the failed open.
    expect(Shard.openCount()).toBe(0)
  })

  test("raises CorruptDatabaseError for a damaged shard and closes it without the checkpoint", () => {
    const id = pid("project-corrupt-damaged")
    Shard.handle(id).use((db) => {
      db.run("CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY)")
      db.run("INSERT INTO probe (id) VALUES (1)")
    })
    Shard.close(id)
    const file = Shard.pathFor(id)
    fs.truncateSync(file, Math.max(1, Math.floor(fs.statSync(file).size / 2)))
    const sizeAfterDamage = fs.statSync(file).size

    expect(() => Shard.handle(id).use(() => "unreachable")).toThrow(CorruptDatabaseError)
    expect(fs.statSync(file).size).toBe(sizeAfterDamage)
    // Closing the poisoned shard must not throw or checkpoint the damaged file.
    expect(() => Shard.closeAll()).not.toThrow()
  })

  test("a brand-new shard takes no backup", () => {
    const id = pid("project-fresh-shard")
    Shard.handle(id).use(() => "fresh open")
    expect(listDatabaseBackups({ dbPath: Shard.pathFor(id) })).toHaveLength(0)
  })

  test("backs up an existing shard before a column migration alters it", () => {
    const id = pid("project-column-migration")
    const file = Shard.pathFor(id)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // Old shard schema: session_goal without the later time_budget_seconds column.
    const old = new DatabaseSync(file)
    old.exec(`CREATE TABLE "session_goal" (
      "session_id" text PRIMARY KEY NOT NULL,
      "objective" text NOT NULL,
      "status" text NOT NULL,
      "token_budget" integer,
      "tokens_used" integer NOT NULL DEFAULT 0,
      "time_used_seconds" integer NOT NULL DEFAULT 0,
      "time_created" integer NOT NULL,
      "time_updated" integer NOT NULL
    )`)
    old.exec(
      `INSERT INTO "session_goal" ("session_id", "objective", "status", "tokens_used", "time_used_seconds", "time_created", "time_updated")
       VALUES ('ses_1', 'finish batch 3', 'active', 0, 0, 1, 1)`,
    )
    old.close()

    Shard.handle(id).use(() => "opens, backs up, migrates")

    const backups = listDatabaseBackups({ dbPath: file })
    expect(backups).toHaveLength(1)
    // The backup is the pre-migration state: old columns only, data intact.
    const ro = new DatabaseSync(backups[0].path, { readOnly: true })
    const backupColumns = ro.prepare("SELECT name FROM pragma_table_info('session_goal')").all() as { name: string }[]
    expect(backupColumns.map((column) => column.name)).not.toContain("time_budget_seconds")
    expect(ro.prepare("SELECT objective FROM session_goal").all()).toEqual([{ objective: "finish batch 3" }])
    ro.close()

    // The live shard gained the new column.
    const client = Shard.peek(id)!.$client
    const columns = client.prepare(`PRAGMA table_info("session_goal")`).all() as { name: string }[]
    expect(columns.map((column) => column.name)).toContain("time_budget_seconds")
    Shard.close(id)
  })
})
