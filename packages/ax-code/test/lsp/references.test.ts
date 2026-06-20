import { expect, test } from "vitest"
import { envelope, references } from "../../src/lsp/references"
import type { LSPClient } from "../../src/lsp/client"

test("references envelope uses semantic selection and include-declaration request params", async () => {
  const requests: Array<{ method: string; params: unknown }> = []
  const location = {
    uri: "file:///tmp/project/src/index.ts",
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 4 },
    },
  }
  const client = {
    serverID: "typescript",
    connection: {
      sendRequest(method: string, params: unknown) {
        requests.push({ method, params })
        return Promise.resolve([location])
      },
    },
  } as LSPClient.Info
  let selectedFile = ""
  let selectedOptions: unknown

  const result = await envelope(
    { file: "/tmp/project/src/index.ts", line: 1, character: 2, cache: false },
    {
      timeoutMs: 1_000,
      selectClients: async (file, opts) => {
        selectedFile = file
        selectedOptions = opts
        return { clients: [client], freshSpawnCount: 0 }
      },
    },
  )

  expect(selectedFile).toBe("/tmp/project/src/index.ts")
  expect(selectedOptions).toEqual({ mode: "semantic", method: "references" })
  expect(requests).toEqual([
    {
      method: "textDocument/references",
      params: {
        textDocument: { uri: "file:///tmp/project/src/index.ts" },
        position: { line: 1, character: 2 },
        context: { includeDeclaration: true },
      },
    },
  ])
  expect(result.data).toEqual([location])
  expect(result.completeness).toBe("full")
  expect(result.serverIDs).toEqual(["typescript"])
})

test("references returns only reference payload data", async () => {
  const location = {
    uri: "file:///tmp/project/src/index.ts",
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 4 },
    },
  }
  const client = {
    serverID: "typescript",
    connection: {
      sendRequest: async () => [location],
    },
  } as unknown as LSPClient.Info

  await expect(
    references(
      { file: "/tmp/project/src/index.ts", line: 1, character: 2, cache: false },
      {
        timeoutMs: 1_000,
        selectClients: async () => ({ clients: [client], freshSpawnCount: 0 }),
      },
    ),
  ).resolves.toEqual([location])
})
