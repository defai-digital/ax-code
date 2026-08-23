import { afterEach, describe, expect, test } from "vitest"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { BashOutputTool } from "../../src/tool/bash_output"
import { BashInputTool } from "../../src/tool/bash_input"
import { BackgroundShell } from "../../src/tool/bash-background"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_bash_input_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const projectRoot = path.join(__dirname, "../..")

async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error("waitFor timed out")
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function spawnBackground(command: string) {
  const bash = await BashTool.init()
  const result = await bash.execute({ command, run_in_background: true }, ctx)
  return (result.metadata as any).background.shellID as string
}

afterEach(async () => {
  for (const shell of BackgroundShell.list()) {
    await BackgroundShell.kill(shell.id)
  }
  BackgroundShell.resetForTests()
})

describe("bash_input", () => {
  test("writes text to a background cat and the echo is readable via bash_output", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const shellID = await spawnBackground("cat")

        const input = await BashInputTool.init()
        const writeResult = await input.execute({ shell_id: shellID, input: "hello-stdin\n" }, ctx)
        expect(writeResult.output).toContain(shellID)
        expect(writeResult.output).toContain("running")
        expect((writeResult.metadata as any).shell.id).toBe(shellID)

        const output = await BashOutputTool.init()
        let collected = ""
        await waitFor(async () => {
          const read = await output.execute({ shell_id: shellID, timeout_ms: 1_000 }, ctx)
          collected += read.output
          return collected.includes("hello-stdin")
        })
      },
    })
  })

  test("eof closes stdin so cat exits and the shell completes", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const shellID = await spawnBackground("cat")

        const input = await BashInputTool.init()
        const writeResult = await input.execute({ shell_id: shellID, input: "done\n", eof: true }, ctx)
        expect(writeResult.output).toContain("EOF")

        await waitFor(() => BackgroundShell.get(shellID, ctx.sessionID)?.status === "completed")
        expect(BackgroundShell.get(shellID, ctx.sessionID)?.exitCode).toBe(0)

        // The echo of the written text is still readable after exit.
        const output = await BashOutputTool.init()
        const read = await output.execute({ shell_id: shellID, timeout_ms: 0 }, ctx)
        expect(read.output).toContain("done")
        expect(read.output).toContain("completed")
      },
    })
  })

  test("rejects writes to an unknown shell id", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const input = await BashInputTool.init()
        await expect(input.execute({ shell_id: "bash_9999", input: "x\n" }, ctx)).rejects.toThrow(/No background shell/)
      },
    })
  })

  test("rejects writes to a finished shell", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const shellID = await spawnBackground("echo finished-marker")
        await waitFor(() => BackgroundShell.get(shellID, ctx.sessionID)?.status === "completed")

        const input = await BashInputTool.init()
        await expect(input.execute({ shell_id: shellID, input: "x\n" }, ctx)).rejects.toThrow(/is completed/)
      },
    })
  })

  test("rejects writes from another session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const shellID = await spawnBackground("cat")

        const otherCtx = { ...ctx, sessionID: SessionID.make("ses_bash_input_other") }
        const input = await BashInputTool.init()
        await expect(input.execute({ shell_id: shellID, input: "x\n" }, otherCtx)).rejects.toThrow(
          /No background shell/,
        )
      },
    })
  })

  test("rejects empty input without eof, accepts empty input with eof", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const input = await BashInputTool.init()
        const shellID = await spawnBackground("cat")

        await expect(input.execute({ shell_id: shellID, input: "" }, ctx)).rejects.toThrow(/input is empty/)

        const eofResult = await input.execute({ shell_id: shellID, input: "", eof: true }, ctx)
        expect(eofResult.output).toContain("EOF")
        await waitFor(() => BackgroundShell.get(shellID, ctx.sessionID)?.status === "completed")
      },
    })
  })
})
