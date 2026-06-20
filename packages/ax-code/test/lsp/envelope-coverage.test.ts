import { afterEach, describe, expect, test, vi } from "vitest"
import { pathToFileURL } from "url"
import path from "path"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { LSP } from "../../src/lsp"
import { LSPCache } from "../../src/lsp/cache"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

let configSpy: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  configSpy?.mockRestore()
  configSpy = undefined
  LSP.perfReset()
})

// S1 (envelope extension) coverage: every envelope-returning variant must
// surface the same provenance shape. The "empty" case (no server matches)
// is the cheapest to exercise and covers the full envelope contract on
// each function without needing a running LSP server.
//
// Full/partial completeness paths are covered by workspace-symbol.test.ts
// and will be extended by the S2 cache tests.
describe("LSP envelope coverage (S1)", () => {
  const assertEmptyEnvelope = <T>(envelope: LSP.SemanticEnvelope<T>) => {
    expect(envelope.source).toBe("lsp")
    expect(envelope.completeness).toBe("empty")
    expect(envelope.serverIDs).toEqual([])
    expect(typeof envelope.timestamp).toBe("number")
    expect(envelope.timestamp).toBeGreaterThan(0)
  }

  test("documentSymbolEnvelope returns empty envelope when no server matches", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const x = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = vi.spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)
        const envelope = await LSP.documentSymbolEnvelope(pathToFileURL(file).href)
        assertEmptyEnvelope(envelope)
        expect(envelope.data).toEqual([])
      },
    })
  })

  test("definitionEnvelope returns empty envelope when no server matches", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const x = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = vi.spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)
        const envelope = await LSP.definitionEnvelope({ file, line: 0, character: 0 })
        assertEmptyEnvelope(envelope)
        expect(envelope.data).toEqual([])
      },
    })
  })

  test("referencesEnvelope returns empty envelope when no server matches", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const x = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = vi.spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)
        const envelope = await LSP.referencesEnvelope({ file, line: 0, character: 0 })
        assertEmptyEnvelope(envelope)
        expect(envelope.data).toEqual([])
      },
    })
  })

  test("hoverEnvelope returns empty envelope when no server matches", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const x = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = vi.spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)
        const envelope = await LSP.hoverEnvelope({ file, line: 0, character: 0 })
        assertEmptyEnvelope(envelope)
        expect(envelope.data).toEqual([])
      },
    })
  })

  test("implementationEnvelope returns empty envelope when no server matches", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const x = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = vi.spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)
        const envelope = await LSP.implementationEnvelope({ file, line: 0, character: 0 })
        assertEmptyEnvelope(envelope)
        expect(envelope.data).toEqual([])
      },
    })
  })

  test("call hierarchy envelopes return empty envelopes when no server matches", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const x = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = vi.spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)

        const prepare = await LSP.prepareCallHierarchyEnvelope({ file, line: 0, character: 0 })
        const incoming = await LSP.incomingCallsEnvelope({ file, line: 0, character: 0 })
        const outgoing = await LSP.outgoingCallsEnvelope({ file, line: 0, character: 0 })

        assertEmptyEnvelope(prepare)
        expect(prepare.data).toEqual([])
        assertEmptyEnvelope(incoming)
        expect(incoming.data).toEqual([])
        assertEmptyEnvelope(outgoing)
        expect(outgoing.data).toEqual([])
      },
    })
  })

  test("cache-enabled envelope fallback hashes each file once", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const x = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = vi.spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)
        const hashFileSpy = vi.spyOn(LSPCache, "hashFile")
        try {
          await LSP.documentSymbolEnvelope(pathToFileURL(file).href, { cache: true })
          expect(hashFileSpy).toHaveBeenCalledTimes(1)

          hashFileSpy.mockClear()
          await LSP.referencesEnvelope({ file, line: 0, character: 0, cache: true })
          expect(hashFileSpy).toHaveBeenCalledTimes(1)
        } finally {
          hashFileSpy.mockRestore()
        }
      },
    })
  })

  test("bare functions remain back-compat wrappers returning data arrays", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const x = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        configSpy = vi.spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)

        expect(await LSP.documentSymbol(pathToFileURL(file).href)).toEqual([])
        expect(await LSP.definition({ file, line: 0, character: 0 })).toEqual([])
        expect(await LSP.references({ file, line: 0, character: 0 })).toEqual([])
        expect(await LSP.hover({ file, line: 0, character: 0 })).toEqual([])
        expect(await LSP.implementation({ file, line: 0, character: 0 })).toEqual([])
        expect(await LSP.prepareCallHierarchy({ file, line: 0, character: 0 })).toEqual([])
        expect(await LSP.incomingCalls({ file, line: 0, character: 0 })).toEqual([])
        expect(await LSP.outgoingCalls({ file, line: 0, character: 0 })).toEqual([])
      },
    })
  })
})
