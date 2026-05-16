import { ProjectTable } from "./project.sql"
import { SessionTable } from "../session/session.sql"
import { Database, count, eq } from "../storage/db"

export namespace ProjectIdentity {
  export type WorktreeIdentity = {
    id: string
    sessionCount: number
  }

  export async function listWorktreeIdentities(input: {
    worktree: string
    useDatabase?: typeof Database.use
  }): Promise<WorktreeIdentity[]> {
    const useDatabase = input.useDatabase ?? Database.use
    return await useDatabase((db) =>
      db
        .select({ id: ProjectTable.id, sessionCount: count(SessionTable.id) })
        .from(ProjectTable)
        .leftJoin(SessionTable, eq(SessionTable.project_id, ProjectTable.id))
        .where(eq(ProjectTable.worktree, input.worktree))
        .groupBy(ProjectTable.id)
        .all(),
    )
  }

  export async function listDuplicateWorktreeIdentities(input: {
    worktree: string
    currentProjectID?: string
    useDatabase?: typeof Database.use
  }): Promise<Array<WorktreeIdentity & { current: boolean }>> {
    const rows = await listWorktreeIdentities(input)
    if (rows.length <= 1) return []
    return rows.map((row) => ({
      ...row,
      current: row.id === input.currentProjectID,
    }))
  }
}
