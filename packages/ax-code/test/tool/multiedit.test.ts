import { afterEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { FileTime } from "../../src/file/time"
import { MessageID, SessionID } from "../../src/session/schema"
import { MultiEditTool } from "../../src/tool/multiedit"
import { tmpdir } from "../fixture/fixture"
import { Bus } from "../../src/bus"
import { File } from "../../src/file"
import { FileWatcher } from "../../src/file/watcher"

const ctx = {
  sessionID: SessionID.make("ses_test-multiedit"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.multiedit", () => {
  test("rolls back earlier written files when a later write fails", async () => {
    await using tmp = await tmpdir()
    const first = path.join(tmp.path, "a.txt")
    const second = path.join(tmp.path, "b.txt")
    await fs.writeFile(first, "one\n", "utf-8")
    await fs.writeFile(second, "two\n", "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await FileTime.read(ctx.sessionID, first)
        await FileTime.read(ctx.sessionID, second)
        const tool = await MultiEditTool.init()
        const events: string[] = []
        const unsubEdited = Bus.subscribe(File.Event.Edited, () => events.push("edited"))
        const unsubUpdated = Bus.subscribe(FileWatcher.Event.Updated, () => events.push("updated"))
        let approvals = 0
        const racingCtx = {
          ...ctx,
          ask: async () => {
            approvals += 1
            if (approvals === 2) await fs.writeFile(second, "external update\n", "utf-8")
          },
        }

        try {
          await expect(
            tool.execute(
              {
                filePath: first,
                edits: [
                  { filePath: first, oldString: "one", newString: "ONE" },
                  { filePath: second, oldString: "two", newString: "TWO" },
                ],
              },
              racingCtx as any,
            ),
          ).rejects.toThrow("modified since it was last read")
        } finally {
          unsubEdited()
          unsubUpdated()
        }

        expect(await fs.readFile(first, "utf-8")).toBe("one\n")
        expect(await fs.readFile(second, "utf-8")).toBe("external update\n")
        expect(events).toContain("edited")
        expect(events).toContain("updated")
      },
    })
  })

  test("does not overwrite a file changed after permission approval", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "test.txt")
    await fs.writeFile(file, "one\ntwo\n", "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await FileTime.read(ctx.sessionID, file)
        const tool = await MultiEditTool.init()
        let raced = false
        const racingCtx = {
          ...ctx,
          ask: async () => {
            if (raced) return
            raced = true
            await fs.writeFile(file, "external update\n", "utf-8")
          },
        }

        await expect(
          tool.execute(
            {
              filePath: file,
              edits: [{ filePath: file, oldString: "one", newString: "ONE" }],
            },
            racingCtx as any,
          ),
        ).rejects.toThrow("modified since it was last read")

        expect(await fs.readFile(file, "utf-8")).toBe("external update\n")
      },
    })
  })
})

describe("tool.multiedit diagnostics", () => {
  test("appends LSP errors for changed files to the model-visible output", async () => {
    const { LSP } = await import("@ax-code/ax-code-intel")
    const { vi } = await import("vitest")
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "a.ts")
    await fs.writeFile(file, "const one = 1\n", "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await FileTime.read(ctx.sessionID, file)
        vi.spyOn(LSP, "touchFile").mockResolvedValue(undefined as any)
        vi.spyOn(LSP, "diagnostics").mockResolvedValue({
          [file]: [
            {
              severity: 1,
              message: "Type 'string' is not assignable to type 'number'.",
              range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
            },
          ],
        } as any)
        try {
          const tool = await MultiEditTool.init()
          const result = await tool.execute(
            { filePath: file, edits: [{ filePath: file, oldString: "1", newString: '"one"' }] },
            ctx as any,
          )
          expect(result.output).toContain("LSP errors detected in this file, please fix:")
          expect(result.output).toContain("not assignable")
          expect(result.output).toContain(`<diagnostics file="${file}">`)
        } finally {
          vi.restoreAllMocks()
        }
      },
    })
  })
})
