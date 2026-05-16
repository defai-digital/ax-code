import { afterEach, describe, expect, mock, test } from "bun:test"
import { WorkspaceID } from "../../src/control-plane/schema"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { Project } from "../../src/project/project"
import { Database } from "../../src/storage/db"
import { WorkspaceTable } from "../../src/control-plane/workspace.sql"
import { resetDatabase } from "../fixture/db"
import * as adaptors from "../../src/control-plane/adaptors"
import type { Adaptor } from "../../src/control-plane/types"

afterEach(async () => {
  mock.restore()
  await resetDatabase()
  adaptors.removeAdaptor("testing")
})

Log.init({ print: false })

describe("control-plane/workspace.remove", () => {
  test("keeps the DB record when remote adaptor cleanup fails", async () => {
    const { Workspace } = await import("../../src/control-plane/workspace")
    const cleanupError = new Error("remote delete failed")

    const TestAdaptor: Adaptor = {
      configure(config) {
        return config
      },
      async create() {
        throw new Error("not used")
      },
      async remove() {
        throw cleanupError
      },
      async fetch() {
        throw new Error("not used")
      },
    }

    adaptors.installAdaptor("testing", TestAdaptor)

    await using tmp = await tmpdir({ git: true })
    const { project } = await Project.fromDirectory(tmp.path)
    const id = WorkspaceID.ascending()

    Database.use((db) =>
      db
        .insert(WorkspaceTable)
        .values([
          {
            id,
            branch: "main",
            project_id: project.id,
            type: "testing",
            name: "remote-a",
          },
        ])
        .run(),
    )

    await expect(Workspace.remove(id)).rejects.toThrow("remote delete failed")
    expect(Workspace.get(id)).toBeDefined()
  })
})
