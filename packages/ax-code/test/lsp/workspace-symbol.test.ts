import { afterEach, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { LSP } from "../../src/lsp"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

let configSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  configSpy?.mockRestore()
  configSpy = undefined
})

describe("LSP.workspaceSymbol", () => {
  test("primes configured servers on a cold workspace query", async () => {
    await using tmp = await tmpdir({ git: true })
    const serverPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
    await Bun.write(path.join(tmp.path, "demo.ts"), "export const demo = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = spyOn(Config, "get").mockResolvedValue({
          lsp: {
            fake: {
              command: [process.execPath, serverPath],
              extensions: [".ts"],
            },
          },
        } as never)

        const result = await LSP.workspaceSymbol("DemoSymbol")
        expect(result).toHaveLength(1)
        expect(result[0]?.name).toBe("DemoSymbol")
      },
    })
  })
})
