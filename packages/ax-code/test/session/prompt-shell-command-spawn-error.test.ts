import { afterEach, describe, expect, test, vi } from "vitest"
import { EventEmitter } from "node:events"
import { Session } from "../../src/session"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const script = vi.hoisted(() => ({
  run: (proc: EventEmitter) => {
    queueMicrotask(() => proc.emit("error", new Error("spawn ENOENT")))
  },
}))

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
      script.run(proc)
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
      killTree: async () => {},
    },
  }
})

const { executeShellCommand } = await import("../../src/session/prompt/prompt-shell-command")

afterEach(async () => {
  script.run = (proc) => {
    queueMicrotask(() => proc.emit("error", new Error("spawn ENOENT")))
  }
  await Instance.disposeAll()
})

type ShellPart = { type: string; state: { status: string; error?: string; output?: string } }

async function run(controller: AbortController) {
  await using tmp = await tmpdir({
    git: true,
    config: { agent: { build: { model: "openai/gpt-5.2" } } },
  })
  return Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const result = await executeShellCommand(
        {
          sessionID: session.id,
          agent: "build",
          model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.2") },
          command: "missing-shell",
        },
        {
          start: () => controller.signal,
          queuedCallbacks: () => [],
          cancel: async () => {},
          resumeLoop: async () => ({ info: session as any, parts: [] as any }),
        },
      )
      return result!.parts[0] as ShellPart
    },
  })
}

describe("executeShellCommand spawn error", () => {
  test("names the spawn failure instead of a fabricated exit code", async () => {
    const shellPart = await run(new AbortController())
    expect(shellPart.state.status).toBe("error")
    expect(shellPart.state.output ?? "").not.toContain("User aborted the command")
    expect(shellPart.state.error).toContain("Failed to start shell")
    expect(shellPart.state.error).toContain("spawn ENOENT")
    expect(shellPart.state.error).not.toContain("Process exited with code 1")
  })

  test("a spawn failure after a user abort is still an error, not a completed abort", async () => {
    const controller = new AbortController()
    script.run = (proc) => {
      setTimeout(() => {
        controller.abort()
        proc.emit("error", new Error("spawn ENOENT"))
      }, 20)
    }
    const shellPart = await run(controller)
    expect(shellPart.state.status).toBe("error")
    expect(shellPart.state.output ?? "").not.toContain("User aborted the command")
    expect(shellPart.state.error).toContain("Failed to start shell")
    expect(shellPart.state.error).toContain("spawn ENOENT")
  })

  test("an abort that lands after exit but before close keeps the real exit code", async () => {
    const controller = new AbortController()
    script.run = (proc) => {
      setTimeout(() => {
        proc.emit("spawn")
        proc.emit("exit", 3, null)
        controller.abort()
        setImmediate(() => proc.emit("close", 3, null))
      }, 20)
    }
    const shellPart = await run(controller)
    expect(shellPart.state.status).toBe("error")
    expect(shellPart.state.error).toBe("Process exited with code 3")
    expect(shellPart.state.output ?? "").not.toContain("User aborted the command")
  })

  test("an error after a successful spawn is reported as a process error, not a start failure", async () => {
    script.run = (proc) => {
      queueMicrotask(() => {
        proc.emit("spawn")
        proc.emit("error", new Error("kill EPERM"))
      })
    }
    const shellPart = await run(new AbortController())
    expect(shellPart.state.status).toBe("error")
    expect(shellPart.state.error).toContain("Shell process error")
    expect(shellPart.state.error).toContain("kill EPERM")
    expect(shellPart.state.error).not.toContain("Failed to start shell")
  })
})
