import { afterEach, describe, expect, test, vi } from "vitest"
import { EventEmitter } from "node:events"
import { Session } from "../../src/session"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// The shell dies after emitting the first byte of a two-byte UTF-8 sequence.
// The decoder must still hold that byte until EOF, then flush it as U+FFFD
// instead of dropping it silently.
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>()
  return {
    ...actual,
    spawn() {
      const proc = new EventEmitter() as any
      const stdout = new EventEmitter() as any
      stdout.destroy = () => {}
      proc.stdin = undefined
      proc.stdout = stdout
      proc.stderr = undefined
      proc.exitCode = null
      proc.signalCode = null
      proc.pid = 98766
      proc.kill = () => true

      setTimeout(() => {
        stdout.emit("data", Buffer.from("ok "))
        stdout.emit("data", Buffer.from([0xc3]))
        proc.exitCode = 0
        proc.emit("exit", 0, null)
        setImmediate(() => {
          stdout.destroy?.()
          proc.emit("close", 0, null)
        })
      }, 0)

      return proc
    },
  }
})

const { executeShellCommand } = await import("../../src/session/prompt/prompt-shell-command")

afterEach(async () => {
  await Instance.disposeAll()
})

describe("executeShellCommand decoder flush", () => {
  test("emits U+FFFD for an incomplete trailing UTF-8 sequence at EOF", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const controller = new AbortController()

        const result = await executeShellCommand(
          {
            sessionID: session.id,
            agent: "build",
            model: {
              providerID: ProviderID.make("openai"),
              modelID: ModelID.make("gpt-5.2"),
            },
            command: "partial-utf8",
          },
          {
            start: () => controller.signal,
            queuedCallbacks: () => [],
            cancel: async () => {},
            resumeLoop: async () => ({ info: session as any, parts: [] as any }),
          },
        )

        const shellPart = result!.parts[0] as { type: string; state: { status: string; output?: string } }
        expect(shellPart.state.status).toBe("completed")
        // "ok " plus the flushed replacement character, not a dropped byte.
        expect(shellPart.state.output).toBe("ok \uFFFD")
      },
    })
  })
})
