import { afterEach, describe, expect, test, vi } from "vitest"
import { EventEmitter } from "node:events"
import { Session } from "../../src/session"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

vi.mock("child_process", () => ({
  spawn() {
    const proc = new EventEmitter() as any
    proc.stdin = undefined
    proc.stdout = undefined
    proc.stderr = undefined
    proc.exitCode = null
    proc.signalCode = null
    proc.pid = 98765
    proc.kill = () => true

    setTimeout(() => {
      proc.exitCode = null
      proc.signalCode = "SIGTERM"
      proc.emit("close", null, "SIGTERM")
    }, 0)

    return proc
  },
}))

const { executeShellCommand } = await import("../../src/session/prompt-shell-command")

afterEach(async () => {
  await Instance.disposeAll()
})

describe("executeShellCommand signal exits", () => {
  test("marks process terminated by signal as error", async () => {
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
            command: "kill-self-with-signal",
          },
          {
            start: () => controller.signal,
            queuedCallbacks: () => [],
            cancel: async () => {},
            resumeLoop: async () => ({ info: session as any, parts: [] as any }),
          },
        )

        expect(result!.parts).toHaveLength(1)
        const shellPart = result!.parts[0] as { type: string; state: { status: string; error?: string } }
        expect(shellPart.type).toBe("tool")
        expect(shellPart.state.status).toBe("error")
        expect(shellPart.state.error).toBe("Process exited with signal SIGTERM")
      },
    })
  })

  test("pre-aborted commands observe process close without abort timeout", async () => {
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
        const started = Date.now()

        const result = await executeShellCommand(
          {
            sessionID: session.id,
            agent: "build",
            model: {
              providerID: ProviderID.make("openai"),
              modelID: ModelID.make("gpt-5.2"),
            },
            command: "already-aborted",
          },
          {
            start: () => {
              queueMicrotask(() => controller.abort())
              return controller.signal
            },
            queuedCallbacks: () => [],
            cancel: async () => {},
            resumeLoop: async () => ({ info: session as any, parts: [] as any }),
          },
        )

        expect(Date.now() - started).toBeLessThan(1000)
        const shellPart = result!.parts[0] as { type: string; state: { status: string; output?: string } }
        expect(shellPart.state.status).toBe("completed")
        expect(shellPart.state.output).toContain("User aborted the command")
      },
    })
  })
})
