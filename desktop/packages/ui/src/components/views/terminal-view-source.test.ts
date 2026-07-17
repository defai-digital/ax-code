import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, test } from "vitest"

const sourcePath = path.resolve(__dirname, "TerminalView.tsx")
const viteConfigPath = path.resolve(__dirname, "../../../../web/vite.config.ts")

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
    expect(source).toContain("ensureClaimedTerminalSession")
    expect(source).not.toContain("cleanupStaleCreatedTerminalSession")
    expect(source).toContain('splitPaneRightTab === "terminal"')
    expect(source).toContain("terminalStreamConsumerKey(directory, tabId)")
    expect(source).toContain("expectedSessionId: terminalId")
  })

  test("recovers from missing server sessions instead of locking the tab as exited", async () => {
    const source = await readFile(sourcePath, "utf8")
    expect(source).toContain("isMissingSession")
    expect(source).toMatch(
      /setTabSessionId\(directory, tabId, null, \{\s*lifecycle: "idle",\s*expectedSessionId: terminalId/,
    )
    expect(source).toMatch(/session not found/i)
  })

  test("ships the Ghostty runtime asset instead of leaving the terminal renderer blank", async () => {
    const [terminalViewportSource, viteConfigSource] = await Promise.all([
      readFile(path.resolve(__dirname, "../terminal/TerminalViewport.tsx"), "utf8"),
      readFile(viteConfigPath, "utf8"),
    ])

    expect(viteConfigSource).toContain('requireFromUi.resolve("ghostty-web/ghostty-vt.wasm")')
    expect(viteConfigSource).toContain('fileName: "ghostty-vt.wasm"')
    expect(viteConfigSource).toContain('server.middlewares.use("/ghostty-vt.wasm"')
    expect(terminalViewportSource).toContain("onInitializeError")
  })
})
