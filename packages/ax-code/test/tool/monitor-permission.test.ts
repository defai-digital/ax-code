import { afterEach, describe, expect, test, vi } from "vitest"
import { Permission } from "../../src/permission"
import { Session } from "../../src/session"
import { SessionID, MessageID } from "../../src/session/schema"
import { MonitorTool } from "../../src/tool/monitor"
import { BashTool } from "../../src/tool/bash"
import { BackgroundShell } from "../../src/tool/bash-background"
import { Instance } from "../../src/project/instance"
import { Isolation } from "../../src/isolation"
import { tmpdir } from "../fixture/fixture"
import type { Tool } from "../../src/tool/tool"

function context(sessionID: SessionID): Tool.Context {
  return {
    sessionID,
    messageID: MessageID.make(""),
    callID: "",
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => {},
    ask: async () => {},
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const shell of BackgroundShell.list()) {
    await BackgroundShell.kill(shell.id)
  }
  BackgroundShell.resetForTests()
  await Instance.disposeAll()
})

describe("tool.monitor permission", () => {
  test("rejects with DeniedError before delegating to BashTool when a rule denies bash", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
          permission: [{ permission: "bash", pattern: "*", action: "deny" }],
        })
        // BashTool.execute is only reachable through BashTool.init(); proving
        // init() was never called proves monitor rejected before delegating.
        const init = vi.spyOn(BashTool, "init")
        const monitor = await MonitorTool.init()
        await expect(
          monitor.execute({ command: "echo hi", description: "denied monitor" }, context(session.id)),
        ).rejects.toBeInstanceOf(Permission.DeniedError)
        expect(init).not.toHaveBeenCalled()
        expect(BackgroundShell.list(session.id)).toEqual([])
      },
    })
  })

  test("reaches BashTool with the ask renamed to monitor when bash is allowed", async () => {
    // username keeps this test hermetic where os.userInfo() is unavailable.
    await using tmp = await tmpdir({ git: true, config: { username: "test" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
          permission: [{ permission: "bash", pattern: "*", action: "allow" }],
        })
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const ctx: Tool.Context = {
          ...context(session.id),
          extra: { isolation },
          ask: async (request) => {
            requests.push(request)
          },
        }
        const monitor = await MonitorTool.init()
        const result = await monitor.execute(
          { command: "sleep 30", description: "allowed monitor", persistent: true },
          ctx,
        )
        expect(result.metadata.shellID).toBeTruthy()
        expect(requests.some((request) => request.permission === "monitor")).toBe(true)
        expect(requests.some((request) => request.permission === "bash")).toBe(false)
      },
    })
  })
})
