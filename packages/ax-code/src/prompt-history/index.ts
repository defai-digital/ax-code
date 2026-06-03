import { Database, desc, eq } from "@/storage/db"
import { Instance } from "@/project/instance"
import { PromptHistoryEntry } from "./schema"
import { PromptHistoryTable } from "./prompt-history.sql"
import { Log } from "@/util/log"

export namespace PromptHistory {
  const log = Log.create({ service: "prompt-history" })
  export const MAX_ENTRIES = 50
  let sequence = 0

  function id() {
    sequence = (sequence + 1) % 1_000_000
    return [Date.now().toString().padStart(13, "0"), sequence.toString().padStart(6, "0"), crypto.randomUUID()].join(
      "-",
    )
  }

  export function list(input: { limit?: number } = {}): PromptHistoryEntry[] {
    const limit = Math.min(Math.max(input.limit ?? MAX_ENTRIES, 1), MAX_ENTRIES)
    const rows = Database.use((db) =>
      db
        .select()
        .from(PromptHistoryTable)
        .where(eq(PromptHistoryTable.project_id, Instance.project.id))
        .orderBy(desc(PromptHistoryTable.time_created), desc(PromptHistoryTable.id))
        .limit(limit)
        .all(),
    )

    return rows.reverse().flatMap((row) => {
      const parsed = PromptHistoryEntry.safeParse({
        input: row.input,
        mode: row.mode ?? undefined,
        parts: row.parts,
      })
      if (parsed.success) return [parsed.data]
      log.warn("invalid prompt history row", {
        id: row.id,
        projectID: row.project_id,
        issueCount: parsed.error.issues.length,
      })
      return []
    })
  }

  export function append(entry: PromptHistoryEntry): PromptHistoryEntry {
    const parsed = PromptHistoryEntry.parse(entry)
    const projectID = Instance.project.id
    const directory = Instance.directory
    Database.transaction((db) => {
      const recent = db
        .select()
        .from(PromptHistoryTable)
        .where(eq(PromptHistoryTable.project_id, projectID))
        .orderBy(desc(PromptHistoryTable.time_created), desc(PromptHistoryTable.id))
        .limit(1)
        .all()
      const last = recent[0]
      if (last) {
        const lastEntry = { input: last.input, mode: last.mode ?? undefined, parts: last.parts }
        const newEntry = { input: parsed.input, mode: parsed.mode, parts: parsed.parts }
        if (JSON.stringify(lastEntry) === JSON.stringify(newEntry)) return
      }
      db.insert(PromptHistoryTable)
        .values({
          id: id(),
          project_id: projectID,
          directory,
          input: parsed.input,
          mode: parsed.mode,
          parts: parsed.parts,
          time_created: Date.now(),
        })
        .run()

      const rows = db
        .select({ id: PromptHistoryTable.id })
        .from(PromptHistoryTable)
        .where(eq(PromptHistoryTable.project_id, projectID))
        .orderBy(desc(PromptHistoryTable.time_created), desc(PromptHistoryTable.id))
        .all()

      for (const row of rows.slice(MAX_ENTRIES)) {
        db.delete(PromptHistoryTable).where(eq(PromptHistoryTable.id, row.id)).run()
      }
    })
    return parsed
  }
}
