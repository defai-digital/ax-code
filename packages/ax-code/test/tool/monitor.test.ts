import { afterEach, describe, expect, test } from "vitest"
import type { Permission } from "../../src/permission"
import type { Tool } from "../../src/tool/tool"
import { MonitorTool } from "../../src/tool/monitor"
import { KillShellTool } from "../../src/tool/kill_shell"
import { BackgroundShell } from "../../src/tool/bash-background"
import { Instance } from "../../src/project/instance"
import { Isolation } from "../../src/isolation"
import { Bus } from "../../src/bus"
import { NotificationEvent } from "../../src/notification/events"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const sessionID = SessionID.make("ses_monitor_test")

function context(
  requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = [],
  isolation?: Isolation.State,
): Tool.Context {
  return {
    sessionID,
    messageID: MessageID.make(""),
    callID: "",
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => {},
    extra: isolation ? { isolation } : undefined,
    ask: async (request) => {
      requests.push(request)
    },
  }
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("waitFor timed out")
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

afterEach(async () => {
  for (const shell of BackgroundShell.list()) {
    await BackgroundShell.kill(shell.id)
  }
  BackgroundShell.resetForTests()
  await Instance.disposeAll()
})

describe("tool.monitor", () => {
  test("rejects an invalid filter before starting a process", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const monitor = await MonitorTool.init()
        await expect(
          monitor.execute(
            {
              command: "sleep 30",
              description: "invalid filter",
              filter: "[",
            },
            context(),
          ),
        ).rejects.toThrow("Invalid filter regex")
        expect(BackgroundShell.list(sessionID)).toEqual([])
      },
    })
  })

  test("inherits BashTool read-only isolation and never spawns", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const monitor = await MonitorTool.init()
        const isolation = Isolation.resolve({ mode: "read-only", network: false }, tmp.path, tmp.path)
        await expect(
          monitor.execute(
            {
              command: "echo blocked",
              description: "blocked monitor",
            },
            context([], isolation),
          ),
        ).rejects.toMatchObject({
          name: "IsolationDeniedError",
          reason: "bash",
        })
        expect(BackgroundShell.list(sessionID)).toEqual([])
      },
    })
  })

  test("uses monitor permission, keeps streams separate, and is stoppable with kill_shell", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const ctx = context(requests, isolation)
        const lines: string[] = []
        const unsubscribe = Bus.subscribe(NotificationEvent.MonitorLine, (event) => {
          lines.push(event.properties.line)
        })

        const monitor = await MonitorTool.init()
        const result = await monitor.execute(
          {
            command: "printf stdout; printf stderr >&2; printf '\\n'; printf '\\n' >&2; sleep 30",
            description: "stream monitor",
            persistent: true,
          },
          ctx,
        )
        const shellID = result.metadata.shellID as string

        await waitFor(() => lines.length >= 2)
        expect(lines).toContain("stdout")
        expect(lines).toContain("stderr")
        expect(lines).not.toContain("stdoutstderr")
        expect(requests.some((request) => request.permission === "monitor")).toBe(true)
        expect(requests.some((request) => request.permission === "bash")).toBe(false)

        const kill = await KillShellTool.init()
        const killed = await kill.execute({ shell_id: shellID }, ctx)
        expect(killed.output).toContain("killed")
        expect(BackgroundShell.get(shellID, sessionID)?.status).toBe("killed")
        unsubscribe()
      },
    })
  })

  test("kills non-persistent monitors at their deadline", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const isolation = Isolation.resolve({ mode: "workspace-write", network: false }, tmp.path, tmp.path)
        const monitor = await MonitorTool.init()
        const result = await monitor.execute(
          {
            command: "sleep 30",
            description: "timed monitor",
            timeout_ms: 1_000,
          },
          context([], isolation),
        )
        const shellID = result.metadata.shellID as string

        await waitFor(() => BackgroundShell.get(shellID, sessionID)?.status === "killed")
        expect(BackgroundShell.get(shellID, sessionID)?.status).toBe("killed")
      },
    })
  })
})
