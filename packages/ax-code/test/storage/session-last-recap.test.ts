import { describe, expect, test } from "vitest"
import { DatabaseSync as Database } from "node:sqlite"
import { drizzle } from "drizzle-orm/node-sqlite"
import { readdirSync, readFileSync } from "fs"
import path from "path"
import { eq } from "drizzle-orm"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { SessionTable, type SessionLastRecapData } from "../../src/session/session.sql"
import { SessionID } from "../../src/session/schema"
import { migrate } from "../../src/storage/migrate-journal"

const RECAP_MIGRATION = "20260926120000_session_last_recap"

function migrations(exclude?: string) {
  const dir = path.join(import.meta.dirname, "../../migration")
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== exclude)
    .map((entry) => ({
      sql: readFileSync(path.join(dir, entry.name, "migration.sql"), "utf-8"),
      timestamp: Number(entry.name.split("_")[0]),
      name: entry.name,
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

function sessionValues(recap?: SessionLastRecapData) {
  return {
    id: SessionID.make("ses_recap_migration"),
    project_id: ProjectID.make("proj_recap_migration"),
    slug: "recap-migration",
    directory: "/tmp/recap-migration",
    title: "recap migration",
    version: "1",
    time_created: 1,
    time_updated: 1,
    ...(recap ? { last_recap: recap } : {}),
  }
}

function project(client: ReturnType<typeof drizzle>) {
  client
    .insert(ProjectTable)
    .values({
      id: ProjectID.make("proj_recap_migration"),
      worktree: "/tmp/recap-migration",
      vcs: "git",
      sandboxes: [],
      time_created: 1,
      time_updated: 1,
    })
    .run()
}

function columns(sqlite: Database) {
  return sqlite
    .prepare("PRAGMA table_info(session)")
    .all()
    .map((row) => (row as { name: string }).name)
}

describe("session last_recap column", () => {
  test("adds the nullable column to a database created before it existed", () => {
    const sqlite = new Database(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON")
    try {
      // A user database from before ADR-148: every migration except the recap
      // column, with a session row already written. The legacy row is inserted
      // with raw SQL because Drizzle names every current schema column —
      // including the not-yet-migrated one — in an INSERT.
      migrate(drizzle({ client: sqlite }), migrations(RECAP_MIGRATION))
      sqlite.exec(
        "INSERT INTO project (id, worktree, vcs, sandboxes, time_created, time_updated) VALUES ('proj_recap_migration', '/tmp/recap-migration', 'git', '[]', 1, 1)",
      )
      sqlite.exec(
        "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('ses_recap_migration', 'proj_recap_migration', 'recap-migration', '/tmp/recap-migration', 'recap migration', '1', 1, 1)",
      )
      expect(columns(sqlite)).not.toContain("last_recap")

      migrate(drizzle({ client: sqlite }), migrations())

      expect(columns(sqlite)).toContain("last_recap")
      const row = sqlite.prepare("SELECT last_recap FROM session WHERE id = 'ses_recap_migration'").get() as
        | { last_recap: string | null }
        | undefined
      // Pre-existing sessions carry no recap and simply regenerate one.
      expect(row?.last_recap).toBeNull()
    } finally {
      sqlite.close()
    }
  })

  test("round-trips a bounded recap payload", () => {
    const sqlite = new Database(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON")
    try {
      migrate(drizzle({ client: sqlite }), migrations())
      const client = drizzle({ client: sqlite })
      project(client)
      client
        .insert(SessionTable)
        .values(
          sessionValues({
            text: "Fixed the picker preview and reran the focused suite.",
            time: 1_790_000_000_000,
            scope: "conversation",
          }),
        )
        .run()

      const row = client
        .select()
        .from(SessionTable)
        .where(eq(SessionTable.id, SessionID.make("ses_recap_migration")))
        .get()
      expect(row?.last_recap).toEqual({
        text: "Fixed the picker preview and reran the focused suite.",
        time: 1_790_000_000_000,
        scope: "conversation",
      })
    } finally {
      sqlite.close()
    }
  })

  test("keeps the recap column out of the per-project shard DDL", () => {
    // The session table stays in the registry database; shards own
    // message/part/event_log only (src/storage/shard.ts). Guard against a
    // future shard schema that starts mirroring session columns.
    const source = readFileSync(path.join(import.meta.dirname, "../../src/storage/shard.ts"), "utf-8")
    expect(source).not.toContain("last_recap")
  })
})
