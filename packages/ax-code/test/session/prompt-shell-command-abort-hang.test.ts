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
      proc.pid = 4242
      proc.kill = () => true
      return proc
    },
  }
})

vi.mock("../../src/shell/shell", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/shell/shell")>()
  return {
    ...actual,
    Shell: {
      ...actual.Shell,
      killTree: () => new Promise<void>(() => {}),
    },
  }
})

const { executeShellCommand } = await import("../../src/session/prompt-shell-command")

afterEach(async () => {
  await Instance.disposeAll()
})

describe("executeShellCommand abort hang", () => {
  test("pre-listener abort still bounds a hung killTree", async () => {
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
            command: "hang-on-abort",
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
        const elapsed = Date.now() - started
        expect(elapsed).toBeGreaterThan(4_000)
        expect(elapsed).toBeLessThan(8_000)
        const shellPart = result!.parts[0] as { type: string; state: { status: string; output?: string } }
        expect(shellPart.state.status).toBe("completed")
        expect(shellPart.state.output).toContain("User aborted the command")
      },
    })
  }, 15_000)
})
