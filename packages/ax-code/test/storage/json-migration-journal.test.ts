import { afterEach, expect, test, vi } from "vitest"
import { DatabaseSync } from "node:sqlite"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { tmpdir } from "../fixture/fixture"

const probed = vi.hoisted(() => [] as (string | undefined)[])

vi.mock("../../src/storage/policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/storage/policy")>()
  return {
    ...actual,
    resolveSqliteJournalMode: (input: { path?: string } = {}) => {
      probed.push(input.path)
      return actual.resolveSqliteJournalMode(input)
    },
  }
})

const { JsonMigration } = await import("../../src/storage/json-migration")

afterEach(async () => {
  probed.length = 0
  await fs.rm(path.join(Global.Path.data, "storage"), { recursive: true, force: true })
})

test("the journal mode is chosen for the database file the connection opened", async () => {
  // AX_CODE_DB or a release channel can move the database away from the
  // default leaf; the network-filesystem probe must look at the real file.
  await using tmp = await tmpdir()
  const dbFile = path.join(tmp.path, "custom", "elsewhere.db")
  await fs.mkdir(path.dirname(dbFile), { recursive: true })
  await fs.mkdir(path.join(Global.Path.data, "storage"), { recursive: true })
  const sqlite = new DatabaseSync(dbFile)
  try {
    await JsonMigration.run(sqlite).catch(() => undefined)
  } finally {
    sqlite.close()
  }
  expect(probed.length).toBeGreaterThan(0)
  expect(path.basename(probed[0] ?? "")).toBe("elsewhere.db")
  expect(await fs.realpath(probed[0]!)).toBe(await fs.realpath(dbFile))
})
