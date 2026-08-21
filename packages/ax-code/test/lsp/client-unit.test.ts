import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { LSPClient } from "../../src/lsp/client"
import { Log } from "../../src/util/log"

Log.init({ print: false })

// Pure unit tests split out of client.test.ts — these spawn no fake LSP
// process, they only read source files or call static functions, so they run
// in the deterministic group while the process-spawning interop tests stay
// grouped separately.
describe("LSPClient unit", () => {
  test("registers close and error handlers for dead LSP connections", async () => {
    const clientSrc = await fs.readFile(path.join(import.meta.dirname, "../../src/lsp/client.ts"), "utf-8")
    expect(clientSrc).toContain("connection.onClose")
    expect(clientSrc).toContain("connection.onError")
    expect(clientSrc).toContain("input.onClose?.")
    expect(clientSrc).toContain("get closed()")

    const indexSrc = await fs.readFile(path.join(import.meta.dirname, "../../src/lsp/index-impl.ts"), "utf-8")
    expect(indexSrc).toContain("onClose: () => {")
    expect(indexSrc).toContain("LSPBrokenServer.markBroken(s.broken, key)")
    expect(indexSrc).toContain("s.clients.splice(idx, 1)")
    expect(indexSrc).toContain("client.closed || !client.ping()")
    expect(indexSrc).toContain("lsp client died during spawn, skipping active registration")
  })

  test("diagnostics URI normalization skips non-file URIs", () => {
    const filePath = path.join(process.cwd(), "file.ts")
    expect(LSPClient.diagnosticPathFromUri(new URL(`file://${filePath}`).href)).toBe(filePath)
    expect(LSPClient.diagnosticPathFromUri("untitled:Scratch.ts")).toBeUndefined()
    expect(LSPClient.diagnosticPathFromUri("vscode-notebook-cell:/workspace/notebook.ipynb#cell")).toBeUndefined()
  })

  test("starts diagnostics timeout only after didOpen or didChange is sent", async () => {
    const clientSrc = await fs.readFile(path.join(import.meta.dirname, "../../src/lsp/client.ts"), "utf-8")

    expect(clientSrc).toContain("wait?.start()")
    expect(clientSrc).toContain("await wait?.promise")
    expect(clientSrc).toContain("const diagnosticsSettled = new Promise<void>")
    expect(clientSrc).toContain("const started = new Promise<void>")
    expect(clientSrc).toContain(".then(() => withTimeout(diagnosticsSettled, 3000))")
    expect(clientSrc).not.toContain("await wait\n")
  })
})
