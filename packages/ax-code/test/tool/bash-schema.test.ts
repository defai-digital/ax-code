import { describe, expect, test } from "vitest"
import path from "path"
import z from "zod"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"

const projectRoot = path.join(__dirname, "../..")

describe("BashTool schema", () => {
  test("rejects non-decimal timeout strings", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await BashTool.init()

        expect(() => tool.parameters.parse({ command: "echo ok", timeout: "0x10" })).toThrow()
        expect(() => tool.parameters.parse({ command: "echo ok", timeout: "1e3" })).toThrow()
      },
    })
  })

  test("accepts cmd as a compatibility alias without advertising it", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await BashTool.init()
        expect(tool.parameters.parse({ cmd: "echo ok" })).toMatchObject({ command: "echo ok" })
        expect(tool.parameters.parse({ command: "echo canonical", cmd: "echo alias" })).toMatchObject({
          command: "echo canonical",
        })

        const schema = z.toJSONSchema(tool.parameters) as { properties: Record<string, unknown> }
        expect(Object.keys(schema.properties)).not.toContain("cmd")
        expect(Object.keys(schema.properties)).toContain("command")
      },
    })
  })

  test("default description prefers tracked-file repository counts", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await BashTool.init()
        expect(tool.description).toContain("cloc --vcs=git")
        expect(tool.description).toContain("ignored or untracked")
        expect(tool.description).toContain("do not increase the timeout to compensate")
      },
    })
  })
})
