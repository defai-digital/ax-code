import { afterEach, describe, expect, test } from "bun:test"
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
