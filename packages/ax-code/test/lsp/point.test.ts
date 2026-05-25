import { expect, test } from "bun:test"
import {
  callHierarchyCallsEnvelope,
  callHierarchyCallsForClient,
  pointRequestParams,
  requestEnvelope,
  requestSemanticArrayEnvelope,
  textDocumentPositionParams,
} from "../../src/lsp/point"
import type { LSPClient } from "../../src/lsp/client"

function clientWithResponses(responses: Record<string, unknown>): LSPClient.Info {
  return {
    connection: {
      sendRequest(method: string, params: unknown) {
        const response = responses[method]
        return Promise.resolve(typeof response === "function" ? response(params) : response)
      },
    },
  } as LSPClient.Info
}

test("textDocumentPositionParams builds file URI position payloads", () => {
  expect(textDocumentPositionParams({ file: "/tmp/project/src/index.ts", line: 3, character: 7 })).toEqual({
    textDocument: { uri: "file:///tmp/project/src/index.ts" },
    position: { line: 3, character: 7 },
  })
})

test("pointRequestParams merges extra request params after position params", () => {
  expect(
    pointRequestParams(
      { file: "/tmp/project/src/index.ts", line: 1, character: 2 },
      { context: { includeDeclaration: true } },
    ),
  ).toEqual({
    textDocument: { uri: "file:///tmp/project/src/index.ts" },
    position: { line: 1, character: 2 },
    context: { includeDeclaration: true },
  })
})

test("callHierarchyCallsForClient prepares items then flattens call results", async () => {
  const client = clientWithResponses({
    "textDocument/prepareCallHierarchy": [{ name: "caller" }, { name: "callee" }],
    "callHierarchy/incomingCalls": (params: { item: { name: string } }) => [{ from: params.item.name }],
  })

  await expect(
    callHierarchyCallsForClient(client, { file: "/tmp/project/src/index.ts", line: 1, character: 2 }, {
      request: "callHierarchy/incomingCalls",
      timeoutMs: 1_000,
    }),
  ).resolves.toEqual([{ from: "caller" }, { from: "callee" }])
})

test("callHierarchyCallsForClient returns empty when prepare has no items", async () => {
  const client = clientWithResponses({
    "textDocument/prepareCallHierarchy": [],
  })

  await expect(
    callHierarchyCallsForClient(client, { file: "/tmp/project/src/index.ts", line: 1, character: 2 }, {
      request: "callHierarchy/outgoingCalls",
      timeoutMs: 1_000,
    }),
  ).resolves.toEqual([])
})

test("requestEnvelope returns empty metadata when no client matches", async () => {
  const envelope = await requestEnvelope(
    { file: "/tmp/project/src/index.ts", line: 1, character: 2 },
    {
      request: "textDocument/hover",
      operation: "hover",
      reduce: (results) => results,
      empty: [] as unknown[],
      clientOptions: { mode: "semantic", method: "hover" },
      timeoutMs: 1_000,
      selectClients: async () => ({ clients: [], freshSpawnCount: 0 }),
    },
  )

  expect(envelope).toMatchObject({
    data: [],
    source: "lsp",
    completeness: "empty",
    serverIDs: [],
    degraded: false,
  })
})

test("requestSemanticArrayEnvelope applies semantic method defaults and flattens results", async () => {
  const client = {
    ...clientWithResponses({
      "textDocument/definition": [{ uri: "file:///tmp/project/src/target.ts" }, null],
    }),
    serverID: "fake",
  }
  let selectedOptions: unknown

  const envelope = await requestSemanticArrayEnvelope(
    { file: "/tmp/project/src/index.ts", line: 1, character: 2 },
    {
      metric: "definition",
      request: "textDocument/definition",
      operation: "definition",
      method: "definition",
      timeoutMs: 1_000,
      selectClients: async (_file, opts) => {
        selectedOptions = opts
        return { clients: [client], freshSpawnCount: 0 }
      },
    },
  )

  expect(selectedOptions).toEqual({ mode: "semantic", method: "definition" })
  expect(envelope.data).toEqual([{ uri: "file:///tmp/project/src/target.ts" }])
  expect(envelope.completeness).toBe("full")
  expect(envelope.serverIDs).toEqual(["fake"])
})

test("callHierarchyCallsEnvelope delegates through selected clients", async () => {
  const client = {
    ...clientWithResponses({
      "textDocument/prepareCallHierarchy": [{ name: "caller" }],
      "callHierarchy/incomingCalls": (params: { item: { name: string } }) => [{ from: params.item.name }],
    }),
    serverID: "fake",
  }

  const envelope = await callHierarchyCallsEnvelope(
    { file: "/tmp/project/src/index.ts", line: 1, character: 2 },
    {
      metric: "incomingCalls",
      request: "callHierarchy/incomingCalls",
      operation: "incomingCalls",
      timeoutMs: 1_000,
      selectClients: async () => ({ clients: [client], freshSpawnCount: 0 }),
    },
  )

  expect(envelope.data).toEqual([{ from: "caller" }])
  expect(envelope.completeness).toBe("full")
  expect(envelope.serverIDs).toEqual(["fake"])
})
