import { afterEach, describe, expect, test } from "vitest"
import path from "path"
import fs from "fs/promises"
import { ReadTool } from "../../src/tool/read"
import { ListTool } from "../../src/tool/ls"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { MessageID, SessionID } from "../../src/session/schema"

// Permission rules and local policies name files workspace-relatively
// (`src/**`, `.env`, `*.key`) — that is what `docs/policies/*.json`, the
// built-in `.env` read guard and the write/edit/multiedit tools use. A file
// tool that asks with an absolute pattern can therefore never match those
// rules: the anchored wildcard fails and the rule is silently ignored.
function recordingContext(asks: { permission: string; patterns: string[] }[]) {
  return {
    sessionID: SessionID.make("ses_file_permission_pattern"),
    messageID: MessageID.make(""),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => {},
    ask: async (input: { permission: string; patterns: string[] }) => {
      asks.push({ permission: input.permission, patterns: input.patterns })
    },
  }
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("file tool permission patterns", () => {
  test("read asks with the workspace-relative path", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await fs.writeFile(path.join(dir, "src", "app.ts"), "export const app = true\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const asks: { permission: string; patterns: string[] }[] = []
        const read = await ReadTool.init()
        await read.execute({ filePath: path.join(tmp.path, "src", "app.ts") }, recordingContext(asks))

        expect(asks.find((ask) => ask.permission === "read")?.patterns).toEqual(["src/app.ts"])
      },
    })
  })

  test("list asks with the workspace-relative path", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const asks: { permission: string; patterns: string[] }[] = []
        const list = await ListTool.init()
        await list.execute({ path: path.join(tmp.path, "src") }, recordingContext(asks))

        expect(asks.find((ask) => ask.permission === "list")?.patterns).toEqual(["src"])
      },
    })
  })

  test("a policy that denies reads under src/ blocks the read tool", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "src"), { recursive: true })
        await fs.writeFile(path.join(dir, "src", "app.ts"), "export const app = true\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ruleset = Permission.fromPolicy(
          {
            version: "1",
            rules: [{ agent: "*", tools: ["read"], files: ["src/**"], action: "deny" }],
          },
          "build",
        )
        const asks: { permission: string; patterns: string[] }[] = []
        const ctx = recordingContext(asks)
        const read = await ReadTool.init()

        await expect(
          read.execute(
            { filePath: path.join(tmp.path, "src", "app.ts") },
            {
              ...ctx,
              ask: async (input) => {
                await Permission.ask({
                  ...input,
                  sessionID: ctx.sessionID,
                  ruleset,
                  agent: "build",
                })
              },
            },
          ),
        ).rejects.toMatchObject({ name: "PermissionDeniedError" })
      },
    })
  })
})
