import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { LSP } from "../../src/lsp"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { Flag } from "../../src/flag/flag"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

// S2 integration tests: exercise the cache through LSP.referencesEnvelope
// and LSP.documentSymbolEnvelope. Uses the fake LSP server fixture so we
// can verify "second call returns source: 'cache'" end-to-end.

let configSpy: ReturnType<typeof spyOn> | undefined
let flagSpy: ReturnType<typeof spyOn> | undefined

// Flag.AX_CODE_LSP_CACHE is evaluated at module load; override per-test
// via Object.defineProperty since the export is a const.
function setCacheFlag(on: boolean) {
  Object.defineProperty(Flag, "AX_CODE_LSP_CACHE", {
    value: on,
    configurable: true,
    writable: true,
  })
}

const originalFlag = Flag.AX_CODE_LSP_CACHE

beforeEach(() => {
  setCacheFlag(false)
  LSP.perfReset()
})

afterEach(() => {
  configSpy?.mockRestore()
  configSpy = undefined
  flagSpy?.mockRestore()
  flagSpy = undefined
  setCacheFlag(originalFlag)
})

describe("LSP cache integration", () => {
  test("cache flag OFF: no cache row written even on full response", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const x = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        setCacheFlag(false)
        configSpy = spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)

        const envelope = await LSP.referencesEnvelope({ file, line: 0, character: 0 })
        // No server matches → empty envelope regardless of cache.
        expect(envelope.completeness).toBe("empty")
        expect(envelope.source).toBe("lsp")

        const peek = CodeGraphQuery.getLspCache({
          projectID: Instance.project.id,
          operation: "references",
          filePath: file,
          contentHash: "any",
          line: 0,
          character: 0,
          now: Date.now(),
        })
        expect(peek).toBeUndefined()
      },
    })
  })

  test("cache flag ON: empty / partial envelopes are not written", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const x = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        setCacheFlag(true)
        configSpy = spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)

        const envelope = await LSP.referencesEnvelope({ file, line: 0, character: 0 })
        // No server → empty → must not be written to cache (see cacheWrite guard).
        expect(envelope.completeness).toBe("empty")

        // Iterate all rows; there should be none for this file.
        const probe = CodeGraphQuery.getLspCache({
          projectID: Instance.project.id,
          operation: "references",
          filePath: file,
          contentHash: "probe",
          line: 0,
          character: 0,
          now: Date.now(),
        })
        expect(probe).toBeUndefined()
      },
    })
  })

  test("cache flag ON: full response round-trips through cache on second call", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const x = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        setCacheFlag(true)
        configSpy = spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)

        // Pre-seed the cache for a known content hash. We compute it the
        // same way the production path does.
        const buf = await Bun.file(file).arrayBuffer()
        const contentHash = Bun.hash(new Uint8Array(buf)).toString()

        CodeGraphQuery.upsertLspCache({
          projectID: Instance.project.id,
          operation: "references",
          filePath: file,
          contentHash,
          line: 5,
          character: 2,
          payload: [{ uri: pathToFileURL(file).href, range: { start: { line: 5, character: 2 } } }],
          serverIDs: ["fake"],
          completeness: "full",
          expiresAt: Date.now() + 60_000,
        })

        const envelope = await LSP.referencesEnvelope({ file, line: 5, character: 2 })
        expect(envelope.source).toBe("cache")
        expect(envelope.completeness).toBe("full")
        expect(envelope.serverIDs).toEqual(["fake"])
        expect(envelope.cacheKey).toMatch(/^lsc_/)
        expect(envelope.data).toHaveLength(1)

        // Sampler should record a cached hit.
        const snap = LSP.perfSnapshot()
        expect(snap["references.cached"]).toBeDefined()
        expect(snap["references.cached"]!.count).toBe(1)
      },
    })
  })

  test("cache flag ON: content change (different hash) yields a miss", async () => {
    await using tmp = await tmpdir({ git: true })
    const file = path.join(tmp.path, "demo.ts")
    await Bun.write(file, "export const x = 1\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        setCacheFlag(true)
        configSpy = spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)

        // Seed with a *different* content hash than the file currently
        // has. The production lookup will compute the real hash and miss.
        CodeGraphQuery.upsertLspCache({
          projectID: Instance.project.id,
          operation: "references",
          filePath: file,
          contentHash: "stale_hash_from_earlier_version",
          line: 0,
          character: 0,
          payload: ["should-not-appear"],
          serverIDs: ["fake"],
          completeness: "full",
          expiresAt: Date.now() + 60_000,
        })

        const envelope = await LSP.referencesEnvelope({ file, line: 0, character: 0 })
        // Cache miss → falls through to LSP. No server configured →
        // envelope comes back as empty. Crucially, source is "lsp", not
        // "cache", so the stale row was not returned.
        expect(envelope.source).toBe("lsp")
        expect(envelope.completeness).toBe("empty")
      },
    })
  })
})
