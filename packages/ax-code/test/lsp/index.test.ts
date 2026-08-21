import { describe, expect, test } from "vitest"
import path from "path"
import { readFile } from "node:fs/promises"

describe("LSP lifecycle guardrails", () => {
  test("root cache is invalidated when project marker files change", async () => {
    const source = await readFile(path.join(__dirname, "../../../ax-codeintel/src/index-impl.ts"), "utf-8")

    // The subscription itself is a host port (the core glue wires it to the
    // file watcher bus); the guardrail is that the root cache is cleared when
    // a root marker file changes and the subscription is disposed with state.
    expect(source).toContain("codeIntelHost().subscribeRootMarkerChange")
    expect(source).toContain("isRootMarkerFile(file)")
    expect(source).toContain("s.rootCache.clear()")
    expect(source).toContain("state.rootCacheUnsubscribe?.()")
  })

  test("cleanup failures do not mask client initialization failures", async () => {
    const source = await readFile(path.join(__dirname, "../../../ax-codeintel/src/index-impl.ts"), "utf-8")
    const initializeCatch = source.slice(
      source.indexOf("} catch (err) {", source.indexOf("LSPClient.create")),
      source.indexOf("if (!client)", source.indexOf("LSPClient.create")),
    )

    expect(initializeCatch).toContain("await stopLSPProcessBestEffort")
    expect(initializeCatch).toContain("log.error(`Failed to initialize LSP client")
  })
})
