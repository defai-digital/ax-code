import { Database, and, eq, inArray, sql } from "../storage/db"
import { SessionTable, PartTable } from "../session/session.sql"
import { SessionShard } from "../session/shard"
import type { ProjectID } from "../project/schema"

/** Read retained sessions from the registry and their parts from the routed store. */
export function retainedSnapshotHashes(projectID: ProjectID): Set<string> {
  const hashes = new Set<string>()
  const keep = (hash: unknown) => {
    if (typeof hash === "string" && /^[0-9a-f]{40}$/.test(hash)) hashes.add(hash)
  }
  const sessions = Database.use((db) =>
    db
      .select({ id: SessionTable.id, revert: SessionTable.revert })
      .from(SessionTable)
      .where(eq(SessionTable.project_id, projectID))
      .all(),
  )
  for (const session of sessions) keep(session.revert?.snapshot)
  if (!sessions.length) return hashes
  const store = SessionShard.storeForProject(projectID)
  // Bound SQLite parameters and avoid loading unrelated text/tool payloads.
  for (let offset = 0; offset < sessions.length; offset += 128) {
    const ids = sessions.slice(offset, offset + 128).map((session) => session.id)
    const parts = store.use((db) =>
      db
        .select({
          hash: sql<unknown>`case when json_extract(${PartTable.data}, '$.type') = 'patch'
        then json_extract(${PartTable.data}, '$.hash') else json_extract(${PartTable.data}, '$.snapshot') end`,
        })
        .from(PartTable)
        .where(
          and(
            inArray(PartTable.session_id, ids),
            sql`json_extract(${PartTable.data}, '$.type') in ('step-start', 'step-finish', 'patch')`,
          ),
        )
        .all(),
    )
    for (const part of parts) keep(part.hash)
  }
  return hashes
}
