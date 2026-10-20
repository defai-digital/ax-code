import { afterEach, describe, expect, test, vi } from "vitest"
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
import { Filesystem } from "../../src/util/filesystem"

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
  test.skipIf(process.platform === "win32")("does not follow a swapped external symlink during rollback", async () => {
    await using tmp = await tmpdir()
    await using outside = await tmpdir()
    const first = path.join(tmp.path, "a.txt")
    const second = path.join(tmp.path, "b.txt")
    const external = path.join(outside.path, "external.txt")
    await fs.writeFile(first, "one\n")
    await fs.writeFile(second, "two\n")
    await fs.writeFile(external, "ONE\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await FileTime.read(ctx.sessionID, first)
        await FileTime.read(ctx.sessionID, second)
        const tool = await MultiEditTool.init()
        const write = Filesystem.write.bind(Filesystem)
        const spy = vi.spyOn(Filesystem, "write").mockImplementation(async (file, ...args) => {
          if (file === second) {
            await fs.unlink(first)
            await fs.symlink(external, first)
            throw new Error("Second write failed")
          }
          return write(file, ...args)
        })
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
              ctx,
            ),
          ).rejects.toThrow("rollback also failed")
          expect(await fs.readFile(external, "utf8")).toBe("ONE\n")
          expect(await fs.readFile(second, "utf8")).toBe("two\n")
          expect((await fs.lstat(first)).isSymbolicLink()).toBe(true)
        } finally {
          spy.mockRestore()
        }
      },
    })
  })

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

  test("does not write after the turn is aborted during the final check", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "a.txt")
    await fs.writeFile(file, "one\n", "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await FileTime.read(ctx.sessionID, file)
        const tool = await MultiEditTool.init()
        const controller = new AbortController()
        const originalRead = Filesystem.readText.bind(Filesystem)
        let reads = 0
        const readSpy = vi.spyOn(Filesystem, "readText").mockImplementation(async (p: string) => {
          reads += 1
          // The initial snapshot read and the final conflict check each read
          // once; abort while the final check is in flight.
          if (reads === 2) controller.abort()
          return originalRead(p)
        })
        const events: string[] = []
        const unsubscribe = Bus.subscribe(File.Event.Edited, () => events.push("edited"))
        try {
          await expect(
            tool.execute(
              {
                filePath: file,
                edits: [{ filePath: file, oldString: "one", newString: "ONE" }],
              },
              { ...ctx, abort: controller.signal } as any,
            ),
          ).rejects.toThrow(/abort/i)
          expect(await fs.readFile(file, "utf-8")).toBe("one\n")
          expect(events).toEqual([])
        } finally {
          unsubscribe()
          readSpy.mockRestore()
        }
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
