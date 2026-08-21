import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import { Config } from "../../src/config/config"
import { contextFor, noteWorkspaceChange } from "@ax-code/ax-code-intel/cache-context"

let configSpy: MockInstance | undefined

afterEach(() => {
  configSpy?.mockRestore()
  configSpy = undefined
})

// The workspace generation is a module-global monotonic counter, so tests
// compare contexts relatively (before/after a bump) instead of pinning
// absolute values.
describe("LSPCacheContext", () => {
  test("references context tracks the workspace generation", async () => {
    configSpy = vi.spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)

    const before = await contextFor("references")
    noteWorkspaceChange()
    const after = await contextFor("references")

    expect(after).not.toBe(before)
  })

  test("documentSymbol context ignores unrelated workspace edits", async () => {
    configSpy = vi.spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)

    const before = await contextFor("documentSymbol")
    noteWorkspaceChange()

    // documentSymbol depends only on the file's own content (already part of
    // the cache key), so other files changing must not bust its entries.
    expect(await contextFor("documentSymbol")).toBe(before)
  })

  test("context changes with the LSP configuration", async () => {
    configSpy = vi.spyOn(Config, "get").mockResolvedValue({ lsp: {} } as never)
    const base = await contextFor("documentSymbol")

    configSpy.mockResolvedValue({ lsp: { typescript: { disabled: true } } } as never)
    expect(await contextFor("documentSymbol")).not.toBe(base)
  })
})
