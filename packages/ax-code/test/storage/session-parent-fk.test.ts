import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { readdirSync, readFileSync } from "fs"
import path from "path"
import { eq } from "drizzle-orm"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { SessionTable } from "../../src/session/session.sql"
import { SessionID } from "../../src/session/schema"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"

function db() {
  const sqlite = new Database(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON")
  const dir = path.join(import.meta.dirname, "../../migration")
  const entries = readdirSync(dir, { withFileTypes: true })
  const migrations = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      sql: readFileSync(path.join(dir, entry.name, "migration.sql"), "utf-8"),
      timestamp: Number(entry.name.split("_")[0]),
      name: entry.name,
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
  migrate(drizzle({ client: sqlite }), migrations)
  return sqlite
}

describe("session parent fk", () => {
  test("rejects orphan parent ids", () => {
    const sqlite = db()
    try {
      const client = drizzle({ client: sqlite })

      client.insert(ProjectTable).values({
        id: ProjectID.make("proj_test"),
        worktree: "/tmp/test",
        vcs: "git",
        sandboxes: [],
        time_created: 1,
        time_updated: 1,
      }).run()

      expect(() =>
        client.insert(SessionTable).values({
          id: SessionID.make("ses_test"),
          project_id: ProjectID.make("proj_test"),
          parent_id: SessionID.make("ses_missing"),
          slug: "test",
          directory: "/tmp/test",
          title: "test",
          version: "1",
          time_created: 1,
          time_updated: 1,
        }).run(),
      ).toThrow()
    } finally {
      sqlite.close()
    }
  })

  test("nulls child parent ids when parent is deleted", () => {
    const sqlite = db()
    try {
      const client = drizzle({ client: sqlite })

      client.insert(ProjectTable).values({
        id: ProjectID.make("proj_test"),
        worktree: "/tmp/test",
        vcs: "git",
        sandboxes: [],
        time_created: 1,
        time_updated: 1,
      }).run()

      client.insert(SessionTable).values({
        id: SessionID.make("ses_parent"),
        project_id: ProjectID.make("proj_test"),
        slug: "parent",
        directory: "/tmp/test",
        title: "parent",
        version: "1",
        time_created: 1,
        time_updated: 1,
      }).run()

      client.insert(SessionTable).values({
        id: SessionID.make("ses_child"),
        project_id: ProjectID.make("proj_test"),
        parent_id: SessionID.make("ses_parent"),
        slug: "child",
        directory: "/tmp/test",
        title: "child",
        version: "1",
        time_created: 1,
        time_updated: 1,
      }).run()

      client.delete(SessionTable).where(eq(SessionTable.id, SessionID.make("ses_parent"))).run()

      const row = client.select().from(SessionTable).where(eq(SessionTable.id, SessionID.make("ses_child"))).get()
      expect(row?.parent_id).toBeNull()
    } finally {
      sqlite.close()
    }
  })
})
