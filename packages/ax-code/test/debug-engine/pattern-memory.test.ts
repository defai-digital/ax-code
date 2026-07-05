import { eq } from "drizzle-orm"
import { describe, expect, test } from "vitest"
import { storePattern } from "../../src/debug-engine/pattern-memory"
import { DebugPatternTable } from "../../src/debug-engine/schema.sql"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { tmpdir } from "../fixture/fixture"

describe("debug-engine pattern memory", () => {
  test("deduplicates extracted keywords while preserving first occurrence order", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        Database.use((db) => db.delete(DebugPatternTable).where(eq(DebugPatternTable.project_id, projectID)).run())

        await storePattern({
          projectID,
          problem: "Parser parser crashes when decoder decoder receives null payload",
          category: "null_undefined",
          fixPattern: "Validate decoder payload before parser uses payload",
          affectedFiles: ["src/parser/index.ts"],
        })

        const row = Database.use((db) =>
          db.select().from(DebugPatternTable).where(eq(DebugPatternTable.project_id, projectID)).get(),
        )

        expect(row?.keywords.slice(0, 5)).toEqual(["parser", "crashes", "decoder", "receives", "null"])

        Database.use((db) => db.delete(DebugPatternTable).where(eq(DebugPatternTable.project_id, projectID)).run())
      },
    })
  })
})
