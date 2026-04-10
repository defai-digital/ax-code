import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { FileTime } from "../../src/file/time"
import { MessageID, SessionID } from "../../src/session/schema"
import { MultiEditTool } from "../../src/tool/multiedit"
import { tmpdir } from "../fixture/fixture"

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
  test("rolls back earlier edits when a later edit fails", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "test.txt")
    await fs.writeFile(file, "one\ntwo\n", "utf-8")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await FileTime.read(ctx.sessionID, file)
        const tool = await MultiEditTool.init()

        await expect(
          tool.execute(
            {
              filePath: file,
              edits: [
                { filePath: file, oldString: "one", newString: "ONE" },
                { filePath: file, oldString: "missing", newString: "MISS" },
              ],
            },
            ctx as any,
          ),
        ).rejects.toThrow()

        expect(await fs.readFile(file, "utf-8")).toBe("one\ntwo\n")
      },
    })
  })
})
