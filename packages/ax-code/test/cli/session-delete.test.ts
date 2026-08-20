import { afterEach, describe, expect, test } from "vitest"
import { SessionDeleteCommand, SessionPruneCommand } from "../../src/cli/cmd/storage/session"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
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

// vitest runs without a TTY on stdin, so the confirmation prompt always takes
// the non-interactive abort path in these tests.

describe("session delete confirmation (#403)", () => {
  test("deletes the session when --force is passed", async () => {
    await using project = await tmpdir({ git: true })
    const session = await Instance.provide({
      directory: project.path,
      fn: async () => Session.create({ title: "force delete" }),
    })

    await withCwd(project.path, () =>
      SessionDeleteCommand.handler({
        sessionID: session.id,
        force: true,
        $0: "ax-code",
        _: ["session", "delete"],
      } as never),
    )

    expect(process.exitCode).toBeUndefined()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect([...Session.list()].map((item) => item.id)).not.toContain(session.id)
      },
    })
  })

  test("aborts without --force when stdin is not interactive", async () => {
    await using project = await tmpdir({ git: true })
    const session = await Instance.provide({
      directory: project.path,
      fn: async () => Session.create({ title: "keep me" }),
    })

    await withCwd(project.path, () =>
      SessionDeleteCommand.handler({
        sessionID: session.id,
        force: false,
        $0: "ax-code",
        _: ["session", "delete"],
      } as never),
    )

    expect(process.exitCode).toBe(1)
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect([...Session.list()].map((item) => item.id)).toContain(session.id)
      },
    })
  })
})

describe("session prune confirmation (#403)", () => {
  test("aborts without --force when stdin is not interactive", async () => {
    await using project = await tmpdir({ git: true })
    const session = await Instance.provide({
      directory: project.path,
      fn: async () => Session.create({ title: "keep me" }),
    })

    await withCwd(project.path, () =>
      SessionPruneCommand.handler({
        days: 30,
        force: false,
        $0: "ax-code",
        _: ["session", "prune"],
      } as never),
    )

    expect(process.exitCode).toBe(1)
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect([...Session.list()].map((item) => item.id)).toContain(session.id)
      },
    })
  })

  test("prunes without prompting when --force is passed", async () => {
    await using project = await tmpdir({ git: true })
    const session = await Instance.provide({
      directory: project.path,
      fn: async () => Session.create({ title: "fresh" }),
    })

    await withCwd(project.path, () =>
      SessionPruneCommand.handler({
        days: 30,
        force: true,
        $0: "ax-code",
        _: ["session", "prune"],
      } as never),
    )

    expect(process.exitCode).toBeUndefined()
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        expect([...Session.list()].map((item) => item.id)).toContain(session.id)
      },
    })
  })
})
