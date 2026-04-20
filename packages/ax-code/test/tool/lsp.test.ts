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
let diagnosticsSpy: ReturnType<typeof spyOn> | undefined
let implementationEnvelopeSpy: ReturnType<typeof spyOn> | undefined
let prepareCallHierarchyEnvelopeSpy: ReturnType<typeof spyOn> | undefined
let incomingCallsEnvelopeSpy: ReturnType<typeof spyOn> | undefined
let outgoingCallsEnvelopeSpy: ReturnType<typeof spyOn> | undefined
let referencesCachedEnvelopeSpy: ReturnType<typeof spyOn> | undefined
let referencesEnvelopeSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  envelopeSpy?.mockRestore()
  hasClientsSpy?.mockRestore()
  touchFileSpy?.mockRestore()
  diagnosticsSpy?.mockRestore()
  implementationEnvelopeSpy?.mockRestore()
  prepareCallHierarchyEnvelopeSpy?.mockRestore()
  incomingCallsEnvelopeSpy?.mockRestore()
  outgoingCallsEnvelopeSpy?.mockRestore()
  referencesCachedEnvelopeSpy?.mockRestore()
  referencesEnvelopeSpy?.mockRestore()
  envelopeSpy = undefined
  hasClientsSpy = undefined
  touchFileSpy = undefined
  diagnosticsSpy = undefined
  implementationEnvelopeSpy = undefined
  prepareCallHierarchyEnvelopeSpy = undefined
  incomingCallsEnvelopeSpy = undefined
  outgoingCallsEnvelopeSpy = undefined
  referencesCachedEnvelopeSpy = undefined
  referencesEnvelopeSpy = undefined
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
        expect(hasClientsSpy).toHaveBeenCalledWith(file, { mode: "semantic", method: "hover" })
        expect(touchFileSpy).toHaveBeenCalledWith(file, true, { mode: "semantic", method: "hover" })
      },
    })
  })

  test("diagnosticsAggregated returns aggregated envelope metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const value = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        hasClientsSpy = spyOn(LSP, "hasClients").mockResolvedValue(true)
        touchFileSpy = spyOn(LSP, "touchFile").mockResolvedValue(1 as never)
        diagnosticsSpy = spyOn(LSP, "diagnosticsAggregated").mockResolvedValue({
          data: [
            {
              path: file,
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 3 },
              },
              severity: "warning",
              message: "unused value",
              serverIDs: ["typescript", "eslint"],
            },
          ],
          source: "lsp",
          completeness: "full",
          timestamp: 1_700_000_000_000,
          serverIDs: ["typescript", "eslint"],
          degraded: false,
        } as any)

        const tool = await LspTool.init()
        const result = await tool.execute({ operation: "diagnosticsAggregated", filePath: file }, ctx)

        expect(diagnosticsSpy).toHaveBeenCalledWith(file)
        const meta = result.metadata as { envelope: { source: string; completeness: string } }
        expect(meta.envelope.source).toBe("lsp")
        expect(meta.envelope.completeness).toBe("full")
        expect(result.output).toContain("unused value")
      },
    })
  })

  test("diagnosticsAggregated does not ask permission for a missing file", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "missing.ts")
    const ask = spyOn({ ask: async () => {} }, "ask")

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const tool = await LspTool.init()
          await expect(
            tool.execute({ operation: "diagnosticsAggregated", filePath: file }, { ...ctx, ask: ask } as any),
          ).rejects.toThrow(`File not found: ${file}`)
          expect(ask).not.toHaveBeenCalled()
        },
      })
    } finally {
      ask.mockRestore()
    }
  })

  test("diagnosticsAggregated does not ask permission when no server matches", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const value = 1\n")
    const ask = spyOn({ ask: async () => {} }, "ask")

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          hasClientsSpy = spyOn(LSP, "hasClients").mockResolvedValue(false)

          const tool = await LspTool.init()
          await expect(
            tool.execute({ operation: "diagnosticsAggregated", filePath: file }, { ...ctx, ask: ask } as any),
          ).rejects.toThrow("No LSP server available for this file type.")
          expect(ask).not.toHaveBeenCalled()
        },
      })
    } finally {
      ask.mockRestore()
    }
  })

  test("findReferences cache hit skips live server startup", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const value = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        hasClientsSpy = spyOn(LSP, "hasClients").mockResolvedValue(true)
        touchFileSpy = spyOn(LSP, "touchFile").mockResolvedValue(1 as never)
        referencesCachedEnvelopeSpy = spyOn(LSP, "referencesCachedEnvelope").mockResolvedValue({
          data: [{ uri: "file:///cached.ts" }],
          source: "cache",
          completeness: "full",
          timestamp: Date.now(),
          serverIDs: ["typescript"],
          cacheKey: "lsc_cached",
          degraded: false,
        } as any)
        referencesEnvelopeSpy = spyOn(LSP, "referencesEnvelope").mockResolvedValue({
          data: [{ uri: "file:///live.ts" }],
          source: "lsp",
          completeness: "full",
          timestamp: Date.now(),
          serverIDs: ["typescript"],
          degraded: false,
        } as any)

        const tool = await LspTool.init()
        const result = await tool.execute({ operation: "findReferences", filePath: file, line: 1, character: 1 }, ctx)

        expect(referencesCachedEnvelopeSpy).toHaveBeenCalledWith({
          file,
          line: 0,
          character: 0,
        })
        expect(hasClientsSpy).not.toHaveBeenCalled()
        expect(touchFileSpy).not.toHaveBeenCalled()
        expect(referencesEnvelopeSpy).not.toHaveBeenCalled()
        const meta = result.metadata as { envelope: { source: string; cacheKey?: string } }
        expect(meta.envelope.source).toBe("cache")
        expect(meta.envelope.cacheKey).toBe("lsc_cached")
      },
    })
  })

  test("findReferences cache miss falls back to cache-enabled live request", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const value = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        referencesCachedEnvelopeSpy = spyOn(LSP, "referencesCachedEnvelope").mockResolvedValue(undefined)
        hasClientsSpy = spyOn(LSP, "hasClients").mockResolvedValue(true)
        touchFileSpy = spyOn(LSP, "touchFile").mockResolvedValue(1 as never)
        referencesEnvelopeSpy = spyOn(LSP, "referencesEnvelope").mockResolvedValue({
          data: [{ uri: "file:///live.ts" }],
          source: "lsp",
          completeness: "full",
          timestamp: Date.now(),
          serverIDs: ["typescript"],
          degraded: false,
        } as any)

        const tool = await LspTool.init()
        await tool.execute({ operation: "findReferences", filePath: file, line: 1, character: 1 }, ctx)

        expect(hasClientsSpy).toHaveBeenCalledWith(file, { mode: "semantic", method: "references" })
        expect(touchFileSpy).toHaveBeenCalledWith(file, true, { mode: "semantic", method: "references" })
        expect(referencesEnvelopeSpy).toHaveBeenCalledWith({
          file,
          line: 0,
          character: 0,
          cache: true,
        })
      },
    })
  })

  test("findReferences falls back to live LSP when cache probe throws", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const value = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        referencesCachedEnvelopeSpy = spyOn(LSP, "referencesCachedEnvelope").mockRejectedValue(new Error("cache down"))
        hasClientsSpy = spyOn(LSP, "hasClients").mockResolvedValue(true)
        touchFileSpy = spyOn(LSP, "touchFile").mockResolvedValue(1 as never)
        referencesEnvelopeSpy = spyOn(LSP, "referencesEnvelope").mockResolvedValue({
          data: [{ uri: "file:///live.ts" }],
          source: "lsp",
          completeness: "full",
          timestamp: Date.now(),
          serverIDs: ["typescript"],
          degraded: false,
        } as any)

        const tool = await LspTool.init()
        const result = await tool.execute({ operation: "findReferences", filePath: file, line: 1, character: 1 }, ctx)

        expect(hasClientsSpy).toHaveBeenCalledWith(file, { mode: "semantic", method: "references" })
        expect(touchFileSpy).toHaveBeenCalledWith(file, true, { mode: "semantic", method: "references" })
        expect(referencesEnvelopeSpy).toHaveBeenCalledWith({
          file,
          line: 0,
          character: 0,
          cache: true,
        })
        expect(result.output).toContain("live.ts")
      },
    })
  })

  test("goToImplementation uses real implementation envelope", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const value = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        hasClientsSpy = spyOn(LSP, "hasClients").mockResolvedValue(true)
        touchFileSpy = spyOn(LSP, "touchFile").mockResolvedValue(1 as never)
        implementationEnvelopeSpy = spyOn(LSP, "implementationEnvelope").mockResolvedValue({
          data: [{ uri: "file:///impl.ts" }],
          source: "lsp",
          completeness: "full",
          timestamp: Date.now(),
          serverIDs: ["typescript"],
          degraded: false,
        } as any)

        const tool = await LspTool.init()
        const result = await tool.execute({ operation: "goToImplementation", filePath: file, line: 1, character: 1 }, ctx)

        expect(implementationEnvelopeSpy).toHaveBeenCalled()
        const meta = result.metadata as { envelope: { serverIDs: string[] } }
        expect(meta.envelope.serverIDs).toEqual(["typescript"])
      },
    })
  })

  test("prepareCallHierarchy uses real envelope metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const value = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        hasClientsSpy = spyOn(LSP, "hasClients").mockResolvedValue(true)
        touchFileSpy = spyOn(LSP, "touchFile").mockResolvedValue(1 as never)
        prepareCallHierarchyEnvelopeSpy = spyOn(LSP, "prepareCallHierarchyEnvelope").mockResolvedValue({
          data: [{ name: "value" }],
          source: "lsp",
          completeness: "full",
          timestamp: Date.now(),
          serverIDs: ["typescript"],
          degraded: false,
        } as any)

        const tool = await LspTool.init()
        const result = await tool.execute({ operation: "prepareCallHierarchy", filePath: file, line: 1, character: 1 }, ctx)

        expect(prepareCallHierarchyEnvelopeSpy).toHaveBeenCalled()
        const meta = result.metadata as { envelope: { serverIDs: string[] } }
        expect(meta.envelope.serverIDs).toEqual(["typescript"])
      },
    })
  })

  test("incomingCalls uses real envelope metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const value = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        hasClientsSpy = spyOn(LSP, "hasClients").mockResolvedValue(true)
        touchFileSpy = spyOn(LSP, "touchFile").mockResolvedValue(1 as never)
        incomingCallsEnvelopeSpy = spyOn(LSP, "incomingCallsEnvelope").mockResolvedValue({
          data: [{ from: "caller" }],
          source: "lsp",
          completeness: "full",
          timestamp: Date.now(),
          serverIDs: ["typescript"],
          degraded: false,
        } as any)

        const tool = await LspTool.init()
        const result = await tool.execute({ operation: "incomingCalls", filePath: file, line: 1, character: 1 }, ctx)

        expect(incomingCallsEnvelopeSpy).toHaveBeenCalled()
        const meta = result.metadata as { envelope: { serverIDs: string[] } }
        expect(meta.envelope.serverIDs).toEqual(["typescript"])
      },
    })
  })

  test("outgoingCalls uses real envelope metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const value = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        hasClientsSpy = spyOn(LSP, "hasClients").mockResolvedValue(true)
        touchFileSpy = spyOn(LSP, "touchFile").mockResolvedValue(1 as never)
        outgoingCallsEnvelopeSpy = spyOn(LSP, "outgoingCallsEnvelope").mockResolvedValue({
          data: [{ to: "callee" }],
          source: "lsp",
          completeness: "full",
          timestamp: Date.now(),
          serverIDs: ["typescript"],
          degraded: false,
        } as any)

        const tool = await LspTool.init()
        const result = await tool.execute({ operation: "outgoingCalls", filePath: file, line: 1, character: 1 }, ctx)

        expect(outgoingCallsEnvelopeSpy).toHaveBeenCalled()
        const meta = result.metadata as { envelope: { serverIDs: string[] } }
        expect(meta.envelope.serverIDs).toEqual(["typescript"])
      },
    })
  })
})
