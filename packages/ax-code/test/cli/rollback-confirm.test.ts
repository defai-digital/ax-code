import { afterEach, describe, expect, test, vi } from "vitest"
import { RollbackCommand } from "../../src/cli/cmd/rollback"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionRevert } from "../../src/session/revert"
import { MessageID } from "../../src/session/schema"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  process.exitCode = undefined
  vi.restoreAllMocks()
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

// vitest runs without a TTY on stdin, so the confirmation prompt must take the
// non-interactive abort path instead of hanging on readline.

describe("session rollback confirmation", () => {
  test("aborts without --force when stdin is not interactive", async () => {
    await using project = await tmpdir({ git: true })
    const session = await Instance.provide({
      directory: project.path,
      fn: async () => Session.create({ title: "rollback confirm" }),
    })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const user = MessageID.ascending()
        const assistant = MessageID.ascending()
        await Session.updateMessage({
          id: user,
          sessionID: session.id,
          role: "user",
          time: { created: 1 },
          agent: "cli",
          model: { providerID: "test", modelID: "test" },
          tools: {},
        } as any)
        await Session.updateMessage({
          id: assistant,
          sessionID: session.id,
          role: "assistant",
          parentID: user,
          providerID: "test",
          modelID: "test-model",
          mode: "chat",
          agent: "cli",
          path: { cwd: project.path, root: project.path },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 2, completed: 3 },
        } as any)
        // A recorded diff drives the handler to the confirmation prompt.
        vi.spyOn(SessionRevert, "preview").mockResolvedValue({
          diffs: [{ file: "src/a.ts", status: "modified", additions: 1, deletions: 1 }],
          descendants: [],
        } as never)

        await withCwd(project.path, () =>
          RollbackCommand.handler({
            sessionID: session.id,
            dryRun: false,
            force: false,
            list: false,
            step: undefined,
            $0: "ax-code",
            _: ["session", "rollback"],
          } as never),
        )

        expect(process.exitCode).toBe(1)
      },
    })
  })
})
