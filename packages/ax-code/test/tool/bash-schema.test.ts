import { describe, expect, test } from "vitest"
import path from "path"
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
})
