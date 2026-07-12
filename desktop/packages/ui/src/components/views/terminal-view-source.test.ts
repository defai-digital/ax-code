import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

const sourcePath = path.resolve(__dirname, "TerminalView.tsx")

describe("TerminalView source guards", () => {
  test("creates a terminal session with fallback dimensions instead of rendering a blank dock", async () => {
    const source = await readFile(sourcePath, "utf8")

    expect(source).toContain("DEFAULT_TERMINAL_CREATE_SIZE")
    expect(source).toContain("resolveTerminalCreateSize(lastViewportSizeRef.current)")
    expect(source).toContain("isConnecting && bufferChunks.length === 0")
  })

  test("does not reconnect the stream on every viewport fit/resize", async () => {
    const source = await readFile(sourcePath, "utf8")

    // Resize must only update size + call the PTY resize API — never force a
    // session effect re-run (that used to disconnect/reconnect on every fit).
    expect(source).not.toContain("viewportSizeVersion")
    expect(source).not.toContain("setViewportSizeVersion")
    expect(source).toContain("withTerminalSessionCreate")
    expect(source).toContain('splitPaneRightTab === "terminal"')
  })

  test("recovers from missing server sessions instead of locking the tab as exited", async () => {
    const source = await readFile(sourcePath, "utf8")
    expect(source).toContain("isMissingSession")
    expect(source).toContain('setTabLifecycle(directory, tabId, "idle")')
    expect(source).toMatch(/session not found/i)
  })
})
