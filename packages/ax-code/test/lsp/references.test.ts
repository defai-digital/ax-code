import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { codeIntelHost } from "@ax-code/ax-code-intel/host"
import { envelope, references } from "@ax-code/ax-code-intel/references"
import type { LSPClient } from "@ax-code/ax-code-intel/client"

// These unit clients run without a core Instance; give their scheduler a stable project scope.
beforeEach(() => {
  vi.spyOn(codeIntelHost(), "projectRoot").mockReturnValue("/tmp/project")
})

afterEach(() => {
  vi.restoreAllMocks()
})

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
