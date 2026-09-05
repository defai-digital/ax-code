import { afterEach, describe, expect, test, vi } from "vitest"
import { SessionListCommand } from "../../src/cli/cmd/storage/session"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  process.exitCode = undefined
  await resetDatabase()
})

async function withCwd<T>(cwd: string, fn: () => T | Promise<T>) {
  const previous = process.cwd()
  process.chdir(cwd)
  try {
    return await fn()
  } finally {
    process.chdir(previous)
  }
}

async function createSessions(project: string, count: number) {
  return Instance.provide({
    directory: project,
    fn: async () => {
      const created = []
      for (let i = 0; i < count; i++) {
        created.push(await Session.create({ title: `session ${i}` }))
      }
      return created
    },
  })
}

describe("session list pagination (#417)", () => {
  test("Session.list limit returns at most N rows regardless of total", async () => {
    await using project = await tmpdir({ git: true })
    await createSessions(project.path, 6)

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect([...Session.list({ roots: true, limit: 2 })]).toHaveLength(2)
        expect([...Session.list({ roots: true })]).toHaveLength(6)
      },
    })
  })

  test("--max-count N --format json paginates before formatting", async () => {
    await using project = await tmpdir({ git: true })
    await createSessions(project.path, 6)

    const useSpy = vi.spyOn(Database, "use")
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    let sessionQueries: unknown[][] = []
    let output = ""
    try {
      await withCwd(project.path, () =>
        SessionListCommand.handler({
          maxCount: 2,
          format: "json",
          $0: "ax-code",
          _: ["session", "list"],
        } as never),
      )
      // The JSON path must paginate at the SQL layer — the query result handed
      // to the formatter is already limited, never the full row set.
      sessionQueries = useSpy.mock.results
        .map((result) => (result.type === "return" ? (result.value as unknown[]) : []))
        .filter((rows) => Array.isArray(rows) && rows.length > 0 && "project_id" in (rows[0] as object))
      output = logSpy.mock.calls.map((call) => String(call[0])).join("\n")
    } finally {
      useSpy.mockRestore()
      logSpy.mockRestore()
    }

    expect(sessionQueries).toHaveLength(1)
    expect(sessionQueries[0]).toHaveLength(2)

    const parsed = JSON.parse(output)
    expect(parsed).toHaveLength(2)
  })
})
