import { afterEach, describe, expect, test } from "vitest"
import path from "path"
import fs from "fs/promises"
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

  test("lists empty directories", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "empty"))
        await fs.mkdir(path.join(dir, "src"))
        await Bun.write(path.join(dir, "src", "app.ts"), "export const app = true\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const list = await ListTool.init()
        const result = await list.execute({}, ctx)

        expect(result.output).toContain("  empty/\n")
        expect(result.output).toContain("  src/\n")
        expect(result.output).toContain("    app.ts\n")
      },
    })
  })

  test("does not list ignored directories", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true })
        await fs.mkdir(path.join(dir, "src"))
        await Bun.write(path.join(dir, "node_modules", "pkg", "index.js"), "module.exports = {}\n")
        await Bun.write(path.join(dir, "src", "app.ts"), "export const app = true\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const list = await ListTool.init()
        const result = await list.execute({}, ctx)

        expect(result.output).toContain("  src/\n")
        expect(result.output).not.toContain("node_modules")
      },
    })
  })
})
