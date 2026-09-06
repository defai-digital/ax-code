import { afterEach, describe, expect, test, vi } from "vitest"
import { BashOutputTool } from "../../src/tool/bash_output"
import { BackgroundShell } from "../../src/tool/bash-background"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: SessionID.make("ses_feedback"),
  messageID: MessageID.make("msg_feedback"),
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

describe("background command timing feedback", () => {
  test("reports command elapsed time and a valid next wait after a maximum-length silent wait", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BashOutputTool.init()
        vi.spyOn(Date, "now").mockReturnValue(300_000)
        vi.spyOn(BackgroundShell, "waitAndRead").mockResolvedValue({
          output: "",
          dropped: false,
          info: {
            id: "bash_1",
            sessionID: ctx.sessionID,
            command: "count-files",
            description: "Count project files",
            status: "running",
            exitCode: null,
            startedAt: 100_000,
            endedAt: null,
          },
        })

        const result = await tool.execute({ shell_id: "bash_1", timeout_ms: 120_000 }, ctx)
        expect(result.metadata.elapsedMs).toBe(200_000)
        expect(result.output).toContain("<elapsed>3m 20s</elapsed>")
        expect(result.output).toContain("up to 120000")
        expect(result.output).toContain("does not indicate how much work remains")
        expect(result.output).not.toContain("wait longer")
        expect(tool.parameters.safeParse({ timeout_ms: 300_000 }).success).toBe(false)
        expect(tool.parameters.safeParse({ timeout_ms: 120_000 }).success).toBe(true)
      },
    })
  })

  test("freezes elapsed time at command completion rather than the time its output is read", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BashOutputTool.init()
        vi.spyOn(BackgroundShell, "waitAndRead").mockResolvedValue({
          output: "42 files",
          dropped: false,
          info: {
            id: "bash_1",
            sessionID: ctx.sessionID,
            command: "count-files",
            description: "Count project files",
            status: "completed",
            exitCode: 0,
            startedAt: 100_000,
            endedAt: 109_000,
          },
        })

        const result = await tool.execute({ shell_id: "bash_1" }, ctx)
        expect(result.metadata.elapsedMs).toBe(9_000)
        expect(result.output).toContain("<elapsed>9s</elapsed>")
        expect(result.output).toContain("42 files")
        expect(result.output).not.toContain("<notice>")
      },
    })
  })
})
