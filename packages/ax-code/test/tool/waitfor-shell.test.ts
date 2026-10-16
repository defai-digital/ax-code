import { afterEach, describe, expect, test } from "vitest"
import { EventEmitter } from "events"
import type { ChildProcess } from "child_process"
import { BackgroundShell } from "../../src/tool/bash-background"
import { BackgroundNotification } from "../../src/session/background-notification"
import { WaitForInternals, WaitForTool } from "../../src/tool/waitfor"
import { MessageID, SessionID } from "../../src/session/schema"

const sessionID = SessionID.make("ses_waitfor_shell_test")

function fakeProc(): ChildProcess {
  const proc = new EventEmitter() as any
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.pid = undefined
  proc.exitCode = null
  return proc as ChildProcess
}

const ctx = () =>
  ({
    sessionID,
    messageID: MessageID.ascending(),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async () => {},
  }) as any

afterEach(async () => {
  WaitForInternals.pollIntervalMs = 1000
  for (const shell of BackgroundShell.list()) {
    await BackgroundShell.kill(shell.id)
  }
  BackgroundShell.resetForTests()
})

describe("tool.waitfor background shells", () => {
  test("waits for a running shell and returns status plus output tail", async () => {
    WaitForInternals.pollIntervalMs = 20
    const proc = fakeProc()
    const info = BackgroundShell.register({
      sessionID,
      command: "noop",
      description: "shell result",
      proc,
    })
    ;(proc.stdout as unknown as EventEmitter).emit("data", Buffer.from("shell output proof\n"))

    const pending = WaitForTool.init().then((tool) => tool.execute({ task_id: info.id, timeout: 30 }, ctx()))
    await new Promise((resolve) => setTimeout(resolve, 80))
    ;(proc as any).exitCode = 0
    ;(proc as unknown as EventEmitter).emit("close")
    const result = await pending

    expect(result.metadata.shellID).toBe(info.id)
    expect(result.metadata.timedOut).toBe(false)
    expect(result.output).toContain(`shell_id: ${info.id}`)
    expect(result.output).toContain("state: completed (exit 0)")
    expect(result.output).toContain("shell output proof")

    // The terminal read consumed the shell record exactly like bash_output,
    // and the pending exit notification was cleared with it.
    expect(BackgroundShell.get(info.id, sessionID)).toBeUndefined()
    expect(BackgroundNotification.pendingCount(sessionID)).toBe(0)
  })

  test("returns Still running when the shell outlives the timeout", async () => {
    WaitForInternals.pollIntervalMs = 20
    const proc = fakeProc()
    const info = BackgroundShell.register({
      sessionID,
      command: "noop",
      description: "slow shell",
      proc,
    })

    const result = await (await WaitForTool.init()).execute({ task_id: info.id, timeout: 1 }, ctx())

    expect(result.metadata.timedOut).toBe(true)
    expect(result.output).toContain("Still running after 1s")
    expect(result.output).toContain(info.id)
    expect(BackgroundShell.get(info.id, sessionID)?.status).toBe("running")
  })

  test("rejects a shell id from another session", async () => {
    const proc = fakeProc()
    const info = BackgroundShell.register({
      sessionID: "ses_waitfor_other",
      command: "noop",
      description: "foreign shell",
      proc,
    })
    await expect((await WaitForTool.init()).execute({ task_id: info.id, timeout: 5 }, ctx())).rejects.toThrow(
      /No background shell with ID/,
    )
  })

  test("rejects an unknown shell id", async () => {
    await expect((await WaitForTool.init()).execute({ task_id: "bash_9999", timeout: 5 }, ctx())).rejects.toThrow(
      /No background shell with ID/,
    )
  })
})
