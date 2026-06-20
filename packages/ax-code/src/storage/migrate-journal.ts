// Runtime-agnostic drizzle migrator that applies a bundled journal array.
//
// `drizzle-orm/bun-sqlite/migrator`'s migrate() accepts an array of
// {sql,timestamp,name} (the AX_CODE_MIGRATIONS / dev journal) and applies it
// via the shared dialect migrate. The `drizzle-orm/node-sqlite/migrator` does
// NOT — it only reads a migrations folder — so the Node build crashed in
// readMigrationFiles(undefined). Both dialects expose `db.dialect.migrate`, so
// we replicate the bun array path here and work on Bun and Node alike.

type JournalEntry = { sql: string; timestamp: number; name: string }

type DialectMigratable = {
  dialect: {
    migrate: (
      migrations: { sql: string[]; folderMillis: number; hash: string; bps: boolean; name?: string }[],
      session: unknown,
      config: { migrationsTable?: string },
    ) => void
  }
  session: unknown
}

export function migrate(db: unknown, journal: JournalEntry[]): void {
  const target = db as DialectMigratable
  const migrations = journal.map((entry) => ({
    sql: entry.sql.split("--> statement-breakpoint"),
    folderMillis: entry.timestamp,
    hash: "",
    bps: true,
    name: entry.name,
  }))
  target.dialect.migrate(migrations, target.session, {})
}
