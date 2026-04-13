import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"
import { LSP } from "../../src/lsp"
import { Log } from "../../src/util/log"

Log.init({ print: false })

let workspaceSymbolSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  workspaceSymbolSpy?.mockRestore()
  workspaceSymbolSpy = undefined
})

describe("file routes", () => {
  test("find symbol delegates to LSP workspaceSymbol", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        workspaceSymbolSpy = spyOn(LSP, "workspaceSymbol").mockResolvedValue([
          {
            name: "DemoSymbol",
            kind: 12,
            location: {
              uri: "file:///workspace/demo.ts",
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 10 },
              },
            },
          },
        ] as any)

        const response = await Server.Default().request("/find/symbol?query=DemoSymbol")
        expect(response.status).toBe(200)
        expect(workspaceSymbolSpy).toHaveBeenCalledWith("DemoSymbol")

        const body = (await response.json()) as Array<{ name: string }>
        expect(body).toHaveLength(1)
        expect(body[0]?.name).toBe("DemoSymbol")
      },
    })
  })
})
