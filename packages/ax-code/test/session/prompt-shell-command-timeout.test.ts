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

const { executeShellCommand, setShellTimeoutForTests } = await import("../../src/session/prompt/prompt-shell-command")

afterEach(async () => {
  setShellTimeoutForTests()
  await Instance.disposeAll()
})

describe("executeShellCommand timeout", () => {
  test("a command that outlives the shell timeout is reported as timed out, not as a user abort", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { agent: { build: { model: "openai/gpt-5.2" } } },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        setShellTimeoutForTests(200)
        const started = Date.now()
        const result = await executeShellCommand(
          {
            sessionID: session.id,
            agent: "build",
            model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.2") },
            command: "hang-forever",
          },
          {
            start: () => new AbortController().signal,
            queuedCallbacks: () => [],
            cancel: async () => {},
            resumeLoop: async () => ({ info: session as any, parts: [] as any }),
          },
        )
        // The hung kill is bounded by the same 5 s grace the abort path uses.
        const elapsed = Date.now() - started
        expect(elapsed).toBeGreaterThan(4_000)
        expect(elapsed).toBeLessThan(10_000)
        const shellPart = result!.parts[0] as { type: string; state: { status: string; output?: string } }
        expect(shellPart.state.output).toContain("Command timed out after 0.2 seconds")
        expect(shellPart.state.output).not.toContain("User aborted the command")
      },
    })
  }, 20_000)

  test("a user abort whose kill grace window outlives the shell timeout is still reported as a user abort", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { agent: { build: { model: "openai/gpt-5.2" } } },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        setShellTimeoutForTests(300)
        const controller = new AbortController()
        setTimeout(() => controller.abort(), 100)
        const started = Date.now()
        const result = await executeShellCommand(
          {
            sessionID: session.id,
            agent: "build",
            model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.2") },
            command: "hang-forever",
          },
          {
            start: () => controller.signal,
            queuedCallbacks: () => [],
            cancel: async () => {},
            resumeLoop: async () => ({ info: session as any, parts: [] as any }),
          },
        )
        const elapsed = Date.now() - started
        expect(elapsed).toBeGreaterThan(4_000)
        expect(elapsed).toBeLessThan(10_000)
        const shellPart = result!.parts[0] as { type: string; state: { status: string; output?: string } }
        expect(shellPart.state.output).toContain("User aborted the command")
        expect(shellPart.state.output).not.toContain("Command timed out")
      },
    })
  }, 20_000)
})
