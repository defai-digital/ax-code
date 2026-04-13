import { afterEach, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { LspTool } from "../../src/tool/lsp"
import { Instance } from "../../src/project/instance"
import { LSP } from "../../src/lsp"
import { SessionID, MessageID } from "../../src/session/schema"
import { Log } from "../../src/util/log"

Log.init({ print: false })

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

let envelopeSpy: ReturnType<typeof spyOn> | undefined
let hasClientsSpy: ReturnType<typeof spyOn> | undefined
let touchFileSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  envelopeSpy?.mockRestore()
  hasClientsSpy?.mockRestore()
  touchFileSpy?.mockRestore()
  envelopeSpy = undefined
  hasClientsSpy = undefined
  touchFileSpy = undefined
})

describe("tool.lsp", () => {
  test("workspaceSymbol returns envelope with provenance", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        envelopeSpy = spyOn(LSP, "workspaceSymbolEnvelope").mockResolvedValue({
          symbols: [
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
          ],
          source: "lsp",
          completeness: "full",
          timestamp: 1_700_000_000_000,
          serverIDs: ["fake"],
        } as any)

        const tool = await LspTool.init()
        const result = await tool.execute({ operation: "workspaceSymbol", query: "DemoSymbol" }, ctx)

        expect(envelopeSpy).toHaveBeenCalledWith("DemoSymbol")
        expect(result.title).toBe("workspaceSymbol DemoSymbol")
        expect(result.output).toContain("DemoSymbol")
        expect(result.output).toContain("\"source\"")
        expect(result.output).toContain("\"completeness\"")
        expect(result.output).toContain("\"timestamp\"")
        const meta = result.metadata as { envelope: { source: string; completeness: string } }
        expect(meta.envelope.source).toBe("lsp")
        expect(meta.envelope.completeness).toBe("full")
      },
    })
  })

  test("file-based operations surface server startup failure", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const value = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        hasClientsSpy = spyOn(LSP, "hasClients").mockResolvedValue(true)
        touchFileSpy = spyOn(LSP, "touchFile").mockResolvedValue(0 as never)

        const tool = await LspTool.init()
        await expect(
          tool.execute({ operation: "hover", filePath: file, line: 1, character: 1 }, ctx),
        ).rejects.toThrow("could not be started")
      },
    })
  })
})
