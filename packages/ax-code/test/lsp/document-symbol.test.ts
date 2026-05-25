import { expect, test } from "bun:test"
import { envelope } from "../../src/lsp/document-symbol"
import type { LSPClient } from "../../src/lsp/client"

test("documentSymbol envelope uses semantic selection and document-symbol request params", async () => {
  const requests: Array<{ method: string; params: unknown }> = []
  const range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 4 },
  }
  const symbol = {
    name: "demo",
    kind: 12,
    range,
    selectionRange: range,
  }
  const client = {
    serverID: "typescript",
    connection: {
      sendRequest(method: string, params: unknown) {
        requests.push({ method, params })
        return Promise.resolve([symbol])
      },
    },
  } as LSPClient.Info
  let selectedFile = ""
  let selectedOptions: unknown

  const result = await envelope("file:///tmp/project/src/index.ts", {
    cache: false,
    timeoutMs: 1_000,
    selectClients: async (file, opts) => {
      selectedFile = file
      selectedOptions = opts
      return { clients: [client], freshSpawnCount: 0 }
    },
  })

  expect(selectedFile).toBe("/tmp/project/src/index.ts")
  expect(selectedOptions).toEqual({ mode: "semantic", method: "documentSymbol" })
  expect(requests).toEqual([
    {
      method: "textDocument/documentSymbol",
      params: { textDocument: { uri: "file:///tmp/project/src/index.ts" } },
    },
  ])
  expect(result.data).toEqual([symbol])
  expect(result.completeness).toBe("full")
  expect(result.serverIDs).toEqual(["typescript"])
})
