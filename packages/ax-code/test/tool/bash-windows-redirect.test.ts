import { describe, expect, test, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import { BashTool } from "../../src/tool/bash"
import { Shell } from "../../src/shell/shell"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: SessionID.make("ses_windows_redirect"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: vi.fn(async () => {}),
}

describe.skipIf(process.platform !== "win32")("Windows POSIX redirect admission", () => {
  const shell = Shell.acceptable()

  test.each([
    "cmd /c type TEST.txt 2>nul & echo ---END---",
    "printf error 2>NUL",
    "printf error >>'nul'",
    'printf error >"./NUL.txt"',
    "printf error >'n'ul",
    "printf error >n\\ul",
    "printf error >'CON.log'",
    "sh -c 'printf error 2>nul'",
    "eval 'printf error >nul'",
  ])("rejects %s before any command side effect", async (command) => {
    await using tmp = await tmpdir({
      config: { shell },
      init: (dir) => fs.writeFile(path.join(dir, "TEST.txt"), "fixture"),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BashTool.init()
        for (const background of [false, true]) {
          ctx.ask.mockClear()
          await expect(
            tool.execute(
              {
                command: `printf started > started.txt; ${command}`,
                run_in_background: background,
                description: "Reproduce reserved redirect",
              },
              ctx,
            ),
          ).rejects.toThrow(/Unsupported Windows redirect target/)
          expect(ctx.ask).not.toHaveBeenCalled()
          expect(await fs.readdir(tmp.path)).not.toContain("started.txt")
          expect((await fs.readdir(tmp.path)).some((name) => /^(nul|con)(\.|$)/i.test(name))).toBe(false)
        }
      },
    })
  })

  test("advertises the actual shell and executes corrected redirects without nul files", async () => {
    await using tmp = await tmpdir({ config: { shell } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BashTool.init()
        expect(tool.description).toContain(shell)
        expect(tool.description).toContain("/dev/null")
        const localModelTool = await BashTool.init({ model: { providerID: "ax-engine", modelID: "test" } })
        expect(localModelTool.description).toContain(shell)
        expect(localModelTool.description).toContain("/dev/null")
        const result = await tool.execute(
          { command: "sh -c 'printf hidden >&2' 2>/dev/null; printf done", description: "Discard stderr safely" },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.output).toBe("done")
        expect(await fs.readdir(tmp.path)).not.toContain("nul")
      },
    })
  })

  test("preserves quoted redirect-looking text and ordinary file redirects", async () => {
    await using tmp = await tmpdir({ config: { shell } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await BashTool.init()
        const result = await tool.execute(
          { command: "printf '%s' '2>nul' > normal.txt; printf done", description: "Write literal text" },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(await fs.readFile(path.join(tmp.path, "normal.txt"), "utf8")).toBe("2>nul")
        expect(await fs.readdir(tmp.path)).not.toContain("nul")
      },
    })
  })
})
