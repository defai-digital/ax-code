import { afterEach, describe, expect, test, vi } from "vitest"
import yargs from "yargs"
import { RollbackCommand, validateRollbackStep } from "../../src/cli/cmd/rollback"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionRollback } from "../../src/session/rollback"
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

describe("session rollback --step", () => {
  test("rejects non-positive-integer and NaN steps", () => {
    expect(validateRollbackStep(undefined)).toBeUndefined()
    expect(validateRollbackStep(2)).toBe(2)
    for (const value of [Number.NaN, 0, -1, 1.5, "2", null]) {
      expect(() => validateRollbackStep(value)).toThrow("--step must be a positive integer")
    }
  })

  test.each(["--step=abc", "--step=0", "--step=1.5", "--step=-2"])(
    "fails at parse time instead of printing Step #NaN: %s",
    async (flag) => {
      // yargs runs `.check` during parse; the failure surfaces as a thrown error
      // (sync or rejected promise), so capture whichever it is.
      let failure: unknown
      try {
        await yargs()
          .command(RollbackCommand as never)
          .exitProcess(false)
          .parseAsync(["rollback", "ses_missing", flag])
      } catch (error) {
        failure = error
      }
      expect(String((failure as Error | undefined)?.message)).toContain("--step must be a positive integer")
    },
  )

  test("a step the session does not have exits 1", async () => {
    await using project = await tmpdir({ git: true })
    const session = await Instance.provide({
      directory: project.path,
      fn: async () => Session.create({ title: "missing step" }),
    })

    await Instance.provide({
      directory: project.path,
      fn: async () => {
        vi.spyOn(Session, "messages").mockResolvedValue([{ info: { role: "user" } }] as never)
        vi.spyOn(SessionRollback, "points").mockResolvedValue([] as never)
        const log = vi.spyOn(console, "log").mockImplementation(() => {})

        await withCwd(project.path, () =>
          RollbackCommand.handler({
            sessionID: session.id,
            dryRun: false,
            force: false,
            list: false,
            step: 99,
            $0: "ax-code",
            _: ["session", "rollback"],
          } as never),
        )

        expect(process.exitCode).toBe(1)
        expect(log.mock.calls.map(([message]) => String(message)).join("\n")).toContain("Step #99 not found")
      },
    })
  })
})
