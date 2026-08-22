import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { LSPClient, textDocumentSyncKind, textDocumentSyncSettings } from "@ax-code/ax-code-intel/client"
import { Log } from "../../src/util/log"

Log.init({ print: false })

// Pure unit tests split out of client.test.ts — these spawn no fake LSP
// process, they only read source files or call static functions, so they run
// in the deterministic group while the process-spawning interop tests stay
// grouped separately.
describe("textDocumentSyncKind", () => {
  test("parses the bare number form", () => {
    expect(textDocumentSyncKind({ textDocumentSync: 2 })).toBe(2)
    expect(textDocumentSyncKind({ textDocumentSync: 0 })).toBe(0)
  })

  test("parses the options-object form", () => {
    expect(textDocumentSyncKind({ textDocumentSync: { openClose: true, change: 1 } })).toBe(1)
  })

  test("returns undefined for missing or malformed declarations", () => {
    expect(textDocumentSyncKind(undefined)).toBeUndefined()
    expect(textDocumentSyncKind({})).toBeUndefined()
    expect(textDocumentSyncKind({ textDocumentSync: { openClose: true } })).toBeUndefined()
    expect(textDocumentSyncKind({ textDocumentSync: "incremental" })).toBeUndefined()
    expect(textDocumentSyncKind({ textDocumentSync: 99 })).toBeUndefined()
  })
})

describe("textDocumentSyncSettings", () => {
  test("honors explicit None", () => {
    expect(textDocumentSyncSettings({ textDocumentSync: 0 })).toEqual({
      openClose: false,
      change: 0,
      save: { enabled: false, includeText: false },
    })
  })

  test("honors open/close and save options", () => {
    expect(
      textDocumentSyncSettings({
        textDocumentSync: { openClose: false, change: 1, save: { includeText: true } },
      }),
    ).toEqual({
      openClose: false,
      change: 1,
      save: { enabled: true, includeText: true },
    })
  })
})
describe("LSPClient unit", () => {
  test("registers close and error handlers for dead LSP connections", async () => {
    const clientSrc = await fs.readFile(path.join(import.meta.dirname, "../../../ax-code-intel/src/client.ts"), "utf-8")
    expect(clientSrc).toContain("connection.onClose")
    expect(clientSrc).toContain("connection.onError")
    expect(clientSrc).toContain("input.onClose?.")
    expect(clientSrc).toContain("get closed()")

    const indexSrc = await fs.readFile(
      path.join(import.meta.dirname, "../../../ax-code-intel/src/index-impl.ts"),
      "utf-8",
    )
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
    const clientSrc = await fs.readFile(path.join(import.meta.dirname, "../../../ax-code-intel/src/client.ts"), "utf-8")

    expect(clientSrc).toContain("wait?.start()")
    expect(clientSrc).toContain("await wait?.promise")
    expect(clientSrc).toContain("const diagnosticsSettled = new Promise<void>")
    expect(clientSrc).toContain("const started = new Promise<void>")
    expect(clientSrc).toContain(".then(() => withTimeout(diagnosticsSettled, 3000))")
    expect(clientSrc).not.toContain("await wait\n")
  })
})
