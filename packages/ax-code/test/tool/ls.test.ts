import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { ListTool } from "../../src/tool/ls"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_test-ls-session"),
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

describe("tool.list", () => {
  test("throws on path with null byte", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const list = await ListTool.init()
        await expect(
          list.execute(
            {
              path: "./safe\x00dir",
            },
            ctx,
          ),
        ).rejects.toThrow("File path contains null byte")
      },
    })
  })

  test("lists files in a directory", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const list = await ListTool.init()
        const result = await list.execute({}, ctx)

        expect(result.output).toContain(`${tmp.path}/`)
      },
    })
  })
})
