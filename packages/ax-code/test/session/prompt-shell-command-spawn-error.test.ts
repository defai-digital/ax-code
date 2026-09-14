import { afterEach, describe, expect, test, vi } from "vitest"
import { EventEmitter } from "node:events"
import { Session } from "../../src/session"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>()
  return {
    ...actual,
    spawn() {
      const proc = new EventEmitter() as any
      proc.stdin = undefined
      proc.stdout = undefined
      proc.stderr = undefined
      proc.exitCode = null
      proc.signalCode = null
      proc.pid = 4243
      proc.kill = () => true
      queueMicrotask(() => proc.emit("error", new Error("spawn ENOENT")))
      return proc
    },
  }
})

const { executeShellCommand } = await import("../../src/session/prompt-shell-command")

afterEach(async () => {
  await Instance.disposeAll()
})

describe("executeShellCommand spawn error", () => {
  test("does not report a spawn failure as a user abort", async () => {
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
            command: "missing-shell",
          },
          {
            start: () => controller.signal,
            queuedCallbacks: () => [],
            cancel: async () => {},
            resumeLoop: async () => ({ info: session as any, parts: [] as any }),
          },
        )
        const shellPart = result!.parts[0] as {
          type: string
          state: { status: string; error?: string; output?: string }
        }
        expect(shellPart.state.status).toBe("error")
        expect(shellPart.state.output ?? "").not.toContain("User aborted the command")
        expect(shellPart.state.error).toContain("Process exited with code 1")
      },
    })
  })
})
