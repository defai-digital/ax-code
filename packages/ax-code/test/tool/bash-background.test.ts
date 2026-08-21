import { afterEach, describe, expect, test } from "vitest"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { BashOutputTool } from "../../src/tool/bash_output"
import { KillShellTool } from "../../src/tool/kill_shell"
import { BackgroundShell } from "../../src/tool/bash-background"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_bg_test"),
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

afterEach(async () => {
  for (const shell of BackgroundShell.list()) {
    await BackgroundShell.kill(shell.id)
  }
  BackgroundShell.resetForTests()
})

describe("bash run_in_background", () => {
  test("returns a shell ID immediately and output is readable after completion", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute({ command: "echo hello-background", run_in_background: true }, ctx)
        const shellID = (result.metadata as any).background.shellID as string
        expect(shellID).toBeTruthy()
        expect(result.output).toContain(shellID)

        await waitFor(() => BackgroundShell.get(shellID, ctx.sessionID)?.status === "completed")

        const output = await BashOutputTool.init()
        const readResult = await output.execute({ shell_id: shellID }, ctx)
        expect(readResult.output).toContain("hello-background")
        expect(readResult.output).toContain("completed")

        // Finished + fully read shells are forgotten.
        expect(BackgroundShell.get(shellID, ctx.sessionID)).toBeUndefined()
      },
    })
  })

  test("kill_shell terminates a long-running background command", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute({ command: "sleep 30", run_in_background: true }, ctx)
        const shellID = (result.metadata as any).background.shellID as string

        const kill = await KillShellTool.init()
        const killResult = await kill.execute({ shell_id: shellID }, ctx)
        expect(killResult.output).toContain("killed")

        const info = BackgroundShell.get(shellID, ctx.sessionID)
        expect(info?.status).toBe("killed")
      },
    })
  })

  test("bash_output without shell_id lists background shells for the session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const output = await BashOutputTool.init()

        const empty = await output.execute({}, ctx)
        expect(empty.output).toContain("No background shells")

        const result = await bash.execute(
          { command: "sleep 30", description: "long sleeper", run_in_background: true },
          ctx,
        )
        const shellID = (result.metadata as any).background.shellID as string

        const listing = await output.execute({}, ctx)
        expect(listing.output).toContain(shellID)
        expect(listing.output).toContain("running")
        expect(listing.output).toContain("long sleeper")
      },
    })
  })

  test("bash_output waits for new output instead of returning empty immediately", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const output = await BashOutputTool.init()
        const result = await bash.execute({ command: "sleep 0.4; echo waited-line", run_in_background: true }, ctx)
        const shellID = (result.metadata as any).background.shellID as string
        const started = Date.now()
        const readResult = await output.execute({ shell_id: shellID, timeout_ms: 5_000 }, ctx)
        expect(Date.now() - started).toBeGreaterThan(250)
        expect(readResult.output).toContain("waited-line")
        expect(readResult.output).not.toContain("no new output")
      },
    })
  })

  test("bash_output timeout_ms 0 stays a non-blocking poll", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const output = await BashOutputTool.init()
        const result = await bash.execute({ command: "sleep 30", run_in_background: true }, ctx)
        const shellID = (result.metadata as any).background.shellID as string
        const started = Date.now()
        const readResult = await output.execute({ shell_id: shellID, timeout_ms: 0 }, ctx)
        expect(Date.now() - started).toBeLessThan(1_000)
        expect(readResult.output).toContain("running")
        expect(readResult.output).toContain("no new output")
      },
    })
  })

  test("incremental reads only return new output", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const output = await BashOutputTool.init()
        const result = await bash.execute(
          { command: "echo first; sleep 1.5; echo second", run_in_background: true },
          ctx,
        )
        const shellID = (result.metadata as any).background.shellID as string

        // Poll until the first line has been produced and consumed.
        let collected = ""
        await waitFor(async () => {
          const read = await output.execute({ shell_id: shellID }, ctx)
          collected += read.output
          return collected.includes("first")
        })

        // Once the shell finishes, the remaining read excludes consumed output.
        await waitFor(() => BackgroundShell.get(shellID, ctx.sessionID)?.status === "completed")
        const final = await output.execute({ shell_id: shellID }, ctx)
        expect(final.output).toContain("second")
        expect(final.output).not.toContain("first")
      },
    })
  })

  test("shells are scoped to their session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute({ command: "sleep 30", run_in_background: true }, ctx)
        const shellID = (result.metadata as any).background.shellID as string

        const otherCtx = { ...ctx, sessionID: SessionID.make("ses_bg_other") }
        const output = await BashOutputTool.init()
        await expect(output.execute({ shell_id: shellID }, otherCtx)).rejects.toThrow(/No background shell/)
        const kill = await KillShellTool.init()
        await expect(kill.execute({ shell_id: shellID }, otherCtx)).rejects.toThrow(/No background shell/)
      },
    })
  })

  test("filter returns only matching lines", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const bash = await BashTool.init()
        const result = await bash.execute(
          { command: "echo alpha-match; echo beta-skip; echo gamma-match", run_in_background: true },
          ctx,
        )
        const shellID = (result.metadata as any).background.shellID as string
        await waitFor(() => BackgroundShell.get(shellID, ctx.sessionID)?.status === "completed")

        const output = await BashOutputTool.init()
        const readResult = await output.execute({ shell_id: shellID, filter: "-match" }, ctx)
        expect(readResult.output).toContain("alpha-match")
        expect(readResult.output).toContain("gamma-match")
        expect(readResult.output).not.toContain("beta-skip")
      },
    })
  })
})
