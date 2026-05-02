import { afterEach, describe, expect, test } from "bun:test"
import { mkdir } from "fs/promises"
import path from "path"
import { doctorProjectContext, getDuplicateProjectIdentityCheck } from "../../src/cli/cmd/doctor"
import { ProjectIdentity } from "../../src/project/project-identity"
import { ProjectTable } from "../../src/project/project.sql"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

describe("cli doctor", () => {
  test("finds project context when launched from a package subdirectory", async () => {
    await using tmp = await tmpdir()
    const packageDir = path.join(tmp.path, "packages", "ax-code")

    await mkdir(path.join(tmp.path, ".git"), { recursive: true })
    await mkdir(path.join(tmp.path, ".ax-code"), { recursive: true })
    await mkdir(packageDir, { recursive: true })
    await Bun.write(path.join(tmp.path, ".git", "HEAD"), "ref: refs/heads/main\n")
    await Bun.write(path.join(tmp.path, "AGENTS.md"), "# Project instructions\n")
    await Bun.write(path.join(tmp.path, ".ax-code", "ax-code.json"), "{}\n")

    const context = await doctorProjectContext(packageDir)

    expect(context.projectRoot).toBe(tmp.path)
    expect(context.agentsPath).toBe(tmp.path)
    expect(context.configPath).toBe(tmp.path)
  })

  test("warns when one worktree has duplicate project identities", async () => {
    await using tmp = await tmpdir()
    const now = Date.now()

    Database.use((db) => {
      db.insert(ProjectTable)
        .values([
          {
            id: "project-one" as any,
            worktree: tmp.path,
            time_created: now,
            time_updated: now,
            sandboxes: [],
          },
          {
            id: "project-two" as any,
            worktree: tmp.path,
            time_created: now,
            time_updated: now,
            sandboxes: [],
          },
        ])
        .run()
    })

    const duplicates = await ProjectIdentity.listDuplicateWorktreeIdentities({
      worktree: tmp.path,
      currentProjectID: "project-one",
    })
    const check = await getDuplicateProjectIdentityCheck({ worktree: tmp.path })

    expect(duplicates.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "project-one", sessionCount: 0, current: true },
      { id: "project-two", sessionCount: 0, current: false },
    ])
    expect(check?.status).toBe("warn")
    expect(check?.detail).toContain("Duplicate project ids")
    expect(check?.detail).toContain("project-one")
    expect(check?.detail).toContain("project-two")
  })
})
