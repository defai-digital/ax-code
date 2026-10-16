import { afterEach, describe, expect, test } from "vitest"
import { BashTool } from "../../src/tool/bash"
import { BackgroundShell } from "../../src/tool/bash-background"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { Permission } from "../../src/permission"
import { SessionID, MessageID } from "../../src/session/schema"

type PermissionRequest = Omit<Permission.Request, "id" | "sessionID" | "tool">

const sessionID = SessionID.make("ses_bash_adopt_test")

const ctx = {
  sessionID,
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async (_req?: PermissionRequest) => {},
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

afterEach(async () => {
  for (const shell of BackgroundShell.list(sessionID)) {
    await BackgroundShell.kill(shell.id, sessionID).catch(() => undefined)
  }
  BackgroundShell.resetForTests()
  await Instance.disposeAll()
})

// Foreground commands that exceed their timeout are adopted by the
// BackgroundShell registry (bash.auto_background_on_timeout, default true)
// instead of being killed. Aborts and explicit opt-out keep the kill path.
describe("tool.bash timeout adoption", () => {
  test.skipIf(process.platform === "win32")(
    "moves a timed-out command to the background instead of killing it",
    async () => {
      await using tmp = await tmpdir({
        git: true,
        // username is set so Config never falls back to os.userInfo(),
        // which sandboxed runners cannot resolve.
        config: { username: "adoption-test" },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const script = "process.stdout.write('adoption-seed-proof\\n'); setTimeout(() => {}, 30000)"
          const result = await bash.execute(
            {
              command: `${shellQuote(process.execPath)} -e ${shellQuote(script)}`,
              timeout: 300,
              description: "Outlive the timeout",
            },
            ctx,
          )

          expect(result.metadata.exit).toBeNull()
          expect((result.metadata.hang as Record<string, unknown>)["timedOut"]).toBe(true)
          const background = (result.metadata as Record<string, any>)["background"] as {
            shellID: string
            adopted: boolean
          }
          expect(background.adopted).toBe(true)
          expect(background.shellID).toMatch(/^bash_\d+$/)
          expect(result.output).toContain("moved to the background")
          expect(result.output).toContain(background.shellID)
          expect(result.output).toContain("bash_output")
          expect(result.output).toContain("waitfor")

          // The live child was adopted: registered under this session, still
          // running, and the output captured before the timeout was seeded.
          expect(BackgroundShell.get(background.shellID, sessionID)?.status).toBe("running")
          const read = BackgroundShell.read(background.shellID, sessionID)
          expect(read?.output).toContain("adoption-seed-proof")

          // The adopted shell joins the normal background lifecycle.
          const killed = await BackgroundShell.kill(background.shellID, sessionID)
          expect(killed?.status).toBe("killed")
          expect(BackgroundShell.get(background.shellID, sessionID)?.status).toBe("killed")
        },
      })
    },
  )

  test.skipIf(process.platform === "win32")("abort before the timeout still kills instead of adopting", async () => {
    await using tmp = await tmpdir({ git: true, config: { username: "adoption-test" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bash = await BashTool.init()
        const controller = new AbortController()
        setTimeout(() => controller.abort(), 150)
        const result = await bash.execute(
          {
            command: `${shellQuote(process.execPath)} -e ${shellQuote("setTimeout(() => {}, 30000)")}`,
            timeout: 60_000,
            description: "Aborted long wait",
          },
          { ...ctx, abort: controller.signal },
        )

        expect((result.metadata.hang as Record<string, unknown>)["aborted"]).toBe(true)
        expect(result.output).toContain("User aborted the command")
        expect(result.output).not.toContain("moved to the background")
        expect(BackgroundShell.list(sessionID)).toEqual([])
      },
    })
  })

  test.skipIf(process.platform === "win32")(
    "opting out via bash.auto_background_on_timeout=false keeps the kill behaviour",
    async () => {
      await using tmp = await tmpdir({
        git: true,
        config: { bash: { auto_background_on_timeout: false }, username: "adoption-test" },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await BashTool.init()
          const result = await bash.execute(
            {
              command: `${shellQuote(process.execPath)} -e ${shellQuote("setTimeout(() => {}, 30000)")}`,
              timeout: 300,
              description: "Kill on timeout",
            },
            ctx,
          )

          expect((result.metadata.hang as Record<string, unknown>)["timedOut"]).toBe(true)
          expect(result.output).toContain("bash tool terminated command after exceeding timeout 300 ms")
          expect(result.output).not.toContain("moved to the background")
          expect(BackgroundShell.list(sessionID)).toEqual([])
        },
      })
    },
  )
})
