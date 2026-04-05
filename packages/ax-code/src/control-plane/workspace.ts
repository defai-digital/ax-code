import { eq } from "drizzle-orm"
import z from "zod"

import { GlobalBus } from "@/bus/global"
import { Database } from "@/storage/db"
import { Project } from "@/project/project"
import { ProjectID } from "@/project/schema"
import { WorkspaceID } from "./schema"
import { WorkspaceTable } from "./workspace.sql"
import { getAdaptor } from "./adaptors"
import { parseSSE } from "./sse"
import { Log } from "@/util/log"

export namespace Workspace {
  const log = Log.create({ service: "workspace" })

  export const Info = z.object({
    id: WorkspaceID.zod,
    projectID: z.string(),
    branch: z.string().nullable().optional(),
    type: z.string(),
    name: z.string().nullable().optional(),
    directory: z.string().nullable().optional(),
    extra: z.record(z.string(), z.any()).optional(),
  })

  export type Info = z.infer<typeof Info>

  const toInfo = (row: typeof WorkspaceTable.$inferSelect): Info => {
    const extra = (() => {
      const next = Info.shape.extra.safeParse(row.extra ?? undefined)
      if (next.success) return next.data
      log.warn("invalid workspace extra", { workspaceID: row.id })
    })()
    return Info.parse({
      id: row.id,
      projectID: row.project_id,
      branch: row.branch,
      type: row.type,
      name: row.name,
      directory: row.directory,
      extra,
    })
  }

  const CreateInput = z.object({
    projectID: ProjectID.zod,
    branch: z.string().optional(),
    type: z.string().default("worktree"),
    name: z.string().optional(),
    directory: z.string().optional(),
    extra: z.record(z.string(), z.any()).optional(),
  })

  export const create = Object.assign(
    async (input: z.input<typeof CreateInput>) => {
      const data = CreateInput.parse(input)
      const id = WorkspaceID.ascending()
      Database.use((db) =>
        db
          .insert(WorkspaceTable)
          .values([
            {
              id,
              project_id: data.projectID,
              branch: data.branch,
              type: data.type,
              name: data.name,
              directory: data.directory,
              extra: data.extra,
            },
          ])
          .run(),
      )
      return get(id)
    },
    { schema: CreateInput },
  )

  export function get(id: WorkspaceID) {
    const row = Database.use((db) => db.select().from(WorkspaceTable).where(eq(WorkspaceTable.id, id)).get())
    if (!row) return
    return toInfo(row)
  }

  export function list(project: Project.Info) {
    return Database.use((db) =>
      db
        .select()
        .from(WorkspaceTable)
        .where(eq(WorkspaceTable.project_id, project.id))
        .all()
        .map(toInfo),
    )
  }

  export async function remove(id: WorkspaceID) {
    const row = get(id)
    if (!row) return
    Database.use((db) => db.delete(WorkspaceTable).where(eq(WorkspaceTable.id, id)).run())
    return row
  }

  export function startSyncing(project: Project.Info) {
    const stop = new AbortController()
    const jobs = list(project)
      .filter((item) => item.type !== "worktree")
      .map(async (item) => {
        const adaptor = getAdaptor(item.type)
        if (!adaptor) return
        const response = await adaptor.fetch(item.extra, "http://workspace.test/event", {
          signal: stop.signal,
        })
        if (!response.body) return
        await parseSSE(response.body, stop.signal, (payload) => {
          GlobalBus.emit("event", {
            directory: item.id,
            payload,
          })
        }).catch((err) => {
          // Log SSE sync failures so a dead workspace connection is
          // visible. Previously this swallowed everything and a
          // broken workspace looked like a healthy one that never
          // received events.
          log.warn("workspace SSE sync lost", {
            workspaceID: item.id,
            type: item.type,
            err,
          })
        })
      })

    return {
      async stop() {
        stop.abort()
        await Promise.allSettled(jobs)
      },
    }
  }
}
