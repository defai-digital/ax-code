import { afterEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { WorkspaceID } from "../../src/control-plane/schema"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { Database } from "../../src/storage/db"
import { Project } from "../../src/project/project"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await resetDatabase()
})

describe("control-plane/workspace recovery", () => {
  test("drops malformed extra data in get and list", async () => {
    const { Workspace } = await import("../../src/control-plane/workspace")
    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const id = WorkspaceID.ascending()

    Database.use((db) =>
      db
        .insert(WorkspaceTable)
        .values({
          id,
          branch: "main",
          project_id: project.id,
          type: "testing",
          name: "remote",
          extra: { ok: true },
        })
        .run(),
    )

    Database.use((db) => {
      db.update(WorkspaceTable).set({ extra: ["bad"] as any }).where(eq(WorkspaceTable.id, id)).run()
    })

    expect(Workspace.get(id)).toMatchObject({
      id,
      extra: undefined,
    })
    expect(Workspace.list(project).find((item) => item.id === id)?.extra).toBeUndefined()
  })
})
