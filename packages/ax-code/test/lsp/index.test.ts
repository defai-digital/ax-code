import { describe, expect, test } from "bun:test"
import path from "path"

describe("LSP lifecycle guardrails", () => {
  test("root cache is invalidated when project marker files change", async () => {
    const source = await Bun.file(path.join(__dirname, "../../src/lsp/index.ts")).text()

    expect(source).toContain("Bus.subscribe(FileWatcher.Event.Updated")
    expect(source).toContain("isRootMarkerFile(event.properties.file)")
    expect(source).toContain("s.rootCache.clear()")
    expect(source).toContain("state.rootCacheUnsubscribe?.()")
  })

  test("cleanup failures do not mask client initialization failures", async () => {
    const source = await Bun.file(path.join(__dirname, "../../src/lsp/index.ts")).text()
    const initializeCatch = source.slice(
      source.indexOf("} catch (err) {", source.indexOf("LSPClient.create")),
      source.indexOf("if (!client)", source.indexOf("LSPClient.create")),
    )

    expect(initializeCatch).toContain("await stopLSPProcessBestEffort")
    expect(initializeCatch).toContain("log.error(`Failed to initialize LSP client")
  })
})
