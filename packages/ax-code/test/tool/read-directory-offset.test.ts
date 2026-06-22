import { afterEach, describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { ReadTool } from "../../src/tool/read"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { MessageID, SessionID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_test"),
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

describe("tool.read directory offsets", () => {
  test("throws when directory offset is beyond the last entry", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "dir", "one.txt"), "one")
        await Bun.write(path.join(dir, "dir", "two.txt"), "two")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()

        await expect(read.execute({ filePath: path.join(tmp.path, "dir"), offset: 3 }, ctx)).rejects.toMatchObject({
          name: "ReadOffsetOutOfRangeError",
          message: `Offset 3 is out of range for this directory (2 entries)`,
        })
      },
    })
  })

  test("allows reading an empty directory at the default offset", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "empty"), { recursive: true })
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const result = await read.execute({ filePath: path.join(tmp.path, "empty") }, ctx)

        expect(result.metadata.truncated).toBe(false)
        expect(result.output).toContain("(0 entries)")
      },
    })
  })
})
